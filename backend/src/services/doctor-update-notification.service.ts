import { Notification } from '@alias/models'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import { publishNotificationToUser } from '@alias/services/realtime-notification.service'

export type DoctorChangeType =
  | 'DOCTOR_REASSIGNED'
  | 'DOSAGE_UPDATED'
  | 'REPORT_UPDATED'
  | 'NEXT_REVIEW_UPDATED'
  | 'INSTRUCTIONS_UPDATED'

type CreateDoctorUpdateNotificationInput = {
  patientUserId: unknown
  changedByDoctorId: unknown
  changeType: DoctorChangeType
  title: string
  message: string
  changedFields?: string[]
  priority?: NotificationPriority
}

export async function createDoctorUpdateNotification(input: CreateDoctorUpdateNotificationInput) {
  const created = await Notification.create({
    user_id: String(input.patientUserId),
    type: NotificationType.DOCTOR_UPDATE,
    priority: input.priority ?? NotificationPriority.HIGH,
    title: input.title,
    message: input.message,
    data: {
      change_type: input.changeType,
      changed_fields: input.changedFields ?? [],
      changed_by_doctor_id: input.changedByDoctorId,
    },
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
  })

  if (!created) {
    throw new Error('Failed to create doctor update notification')
  }

  publishNotificationToUser(String(input.patientUserId), 'doctor_update', {
    id: String(created._id),
    title: created.title,
    message: created.message,
    type: created.type,
    priority: created.priority,
    is_read: created.is_read,
    created_at: created.createdAt,
    data: created.data,
  })

  return created
}
