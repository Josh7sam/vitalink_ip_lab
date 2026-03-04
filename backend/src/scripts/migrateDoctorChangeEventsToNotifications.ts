import mongoose from 'mongoose'
import { config } from '@alias/config'
import { Notification, PatientProfile, User } from '@alias/models'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import logger from '@alias/utils/logger'
import { UserType } from '@alias/validators'

type LegacyEvent = {
  changed_by_doctor_id?: unknown
  change_type?: string
  title?: string
  message?: string
  changed_fields?: string[]
  is_read?: boolean
  created_at?: Date
}

async function run() {
  await mongoose.connect(config.databaseUrl)
  logger.info('Connected to MongoDB for doctor-change-event migration')

  const patientProfiles = await PatientProfile.collection.find({
    doctor_change_events: { $exists: true, $ne: [] }
  }).toArray()

  if (patientProfiles.length === 0) {
    logger.info('No legacy doctor change events found')
    await mongoose.connection.close()
    return
  }

  let insertedCount = 0
  let clearedCount = 0

  for (const profile of patientProfiles) {
    const patientUser = await User.findOne({
      profile_id: profile._id,
      user_type: UserType.PATIENT,
    }).select('_id')

    if (!patientUser) {
      continue
    }

    const events = Array.isArray((profile as any).doctor_change_events)
      ? ((profile as any).doctor_change_events as LegacyEvent[])
      : []

    if (events.length === 0) {
      continue
    }

    const docs = events.map((event) => ({
      user_id: patientUser._id,
      type: NotificationType.DOCTOR_UPDATE,
      priority: NotificationPriority.HIGH,
      title: event.title || 'Doctor update',
      message: event.message || '',
      data: {
        change_type: event.change_type || 'DOCTOR_UPDATE',
        changed_fields: Array.isArray(event.changed_fields) ? event.changed_fields : [],
        changed_by_doctor_id: event.changed_by_doctor_id,
        migrated_from_legacy: true,
      },
      is_read: event.is_read === true,
      read_at: event.is_read ? (event.created_at || new Date()) : undefined,
      createdAt: event.created_at || new Date(),
      updatedAt: event.created_at || new Date(),
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    }))

    if (docs.length > 0) {
      await Notification.collection.insertMany(docs, { ordered: false })
      insertedCount += docs.length
    }

    await PatientProfile.collection.updateOne(
      { _id: profile._id },
      { $unset: { doctor_change_events: '' } }
    )
    clearedCount++
  }

  logger.info(`Migration complete. inserted_notifications=${insertedCount}, cleared_profiles=${clearedCount}`)
  await mongoose.connection.close()
}

run().catch(async (error) => {
  logger.error('Doctor change event migration failed', { error })
  await mongoose.connection.close()
  process.exit(1)
})
