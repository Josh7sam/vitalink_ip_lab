import { Request, Response } from 'express'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { DoctorProfile, PatientProfile, User } from '@alias/models'
import { UserType } from '@alias/validators'
import type {
  CreatePatientInput,
  EditPatientDosageInput,
  ReassignPatientInput,
  UpdateInstructionsInput,
  UpdateNextReviewInput,
  UpdateProfileInput,
  UpdateReportInput
} from '@alias/validators/doctor.validator'
import mongoose from 'mongoose'
import { getDownloadUrl, uploadFile } from '@alias/utils/fileUpload'
import logger from '@alias/utils/logger'
import { getObjectIdString } from '@alias/utils/objectid'

const normalizeLoginId = (value: string) => value.trim()

const getDoctorOwnershipIds = (doctor: { _id: unknown; profile_id?: unknown }): string[] => {
  const ids = new Set<string>()
  const userId = getObjectIdString(doctor._id)
  const profileId = getObjectIdString(doctor.profile_id)
  if (userId) ids.add(userId)
  if (profileId) ids.add(profileId)
  return Array.from(ids)
}

const isDoctorOwnerOfPatient = (patient: { assigned_doctor_id?: unknown }, doctor: { _id: unknown; profile_id?: unknown }): boolean => {
  const assignedDoctorId = getObjectIdString(patient.assigned_doctor_id)
  if (!assignedDoctorId) return false
  const validDoctorIds = new Set(getDoctorOwnershipIds(doctor))
  return validDoctorIds.has(assignedDoctorId)
}

const getDoctorUserOrThrow = async (userId: string) => {
  const doctor = await User.findById(userId)
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  return doctor
}

const getPatientUserOrThrow = async (op_num: string) => {
  const normalizedOpNum = normalizeLoginId(op_num)
  const patientUsers = await User.find({ login_id: normalizedOpNum, user_type: UserType.PATIENT }).limit(2)
  if (patientUsers.length === 0) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (patientUsers.length > 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Multiple patient accounts found for this OP number. Please contact support.')
  }
  return patientUsers[0]
}

const getPatientProfileOrThrow = async (profileId: unknown, notFoundMessage = 'Patient not found') => {
  const patient = await PatientProfile.findById(profileId)
  if (!patient) {
    throw new ApiError(StatusCodes.NOT_FOUND, notFoundMessage)
  }
  return patient
}

type DoctorChangeType = 'DOCTOR_REASSIGNED' | 'DOSAGE_UPDATED' | 'REPORT_UPDATED' | 'NEXT_REVIEW_UPDATED' | 'INSTRUCTIONS_UPDATED'

const buildDoctorChangeEvent = (
  doctorId: unknown,
  changeType: DoctorChangeType,
  title: string,
  message: string,
  changedFields: string[] = []
) => ({
  changed_by_doctor_id: doctorId,
  change_type: changeType,
  title,
  message,
  changed_fields: changedFields,
  is_read: false,
  created_at: new Date(),
})

export const getPatients = asyncHandler(async (req: Request, res: Response) => {
  const { user_id } = req.user
  const doctor = await getDoctorUserOrThrow(user_id)
  const doctorOwnershipIds = getDoctorOwnershipIds(doctor)
  const patientProfiles = await PatientProfile.find({ assigned_doctor_id: { $in: doctorOwnershipIds } })

  // Get login_ids for each patient profile
  const patientUsers = await User.find({
    profile_id: { $in: patientProfiles.map(p => p._id) },
    user_type: UserType.PATIENT
  })

  // Create a map of profile_id to login_id
  const profileToLoginId = new Map<string, string>()
  patientUsers.forEach(u => {
    profileToLoginId.set(u.profile_id?.toString() ?? '', u.login_id)
  })

  // Add login_id to each patient profile
  const patients = patientProfiles.map(p => ({
    ...p.toObject(),
    login_id: profileToLoginId.get(p._id.toString()) ?? null
  }))

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Patients fetched successfully", { patients }))
})

export const viewPatient = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params
  const { user_id } = req.user
  const doctor = await getDoctorUserOrThrow(user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patient = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patient, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient fetched successfully', { patient }))
})

export const addPatient = asyncHandler(async (req: Request<{}, {}, CreatePatientInput['body']>, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Unauthorized')
  }

  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)

  const { name, op_num, age, gender, contact_no, target_inr_min, target_inr_max, therapy, therapy_start_date,
    prescription, medical_history, kin_name, kin_relation, kin_contact_number } = req.body

  const normalizedOpNum = normalizeLoginId(op_num)

  const existingUser = await User.findOne({ login_id: normalizedOpNum })
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Patient with this OP number already exists')
  }

  let parsedTherapyStartDate: Date | undefined = undefined;
  if (therapy_start_date) {
    if (therapy_start_date instanceof Date) {
      parsedTherapyStartDate = therapy_start_date;
    } else if (typeof therapy_start_date === 'string') {
      parsedTherapyStartDate = new Date(therapy_start_date);
      if (isNaN(parsedTherapyStartDate.getTime())) {
        parsedTherapyStartDate = undefined;
      }
    }
  }

  const patientProfile = await PatientProfile.create({
    assigned_doctor_id: doctorUser._id,
    demographics: {
      name,
      age,
      gender,
      phone: contact_no,
      next_of_kin: { name: kin_name, relation: kin_relation, phone: kin_contact_number },
    },
    medical_config: {
      therapy_drug: therapy,
      therapy_start_date: parsedTherapyStartDate,
      target_inr: {
        min: target_inr_min ?? 2.0,
        max: target_inr_max ?? 3.0,
      },
    },
    medical_history: medical_history ?? undefined,
    weekly_dosage: prescription ?? undefined,
  })

  const tempPassword = contact_no
  await User.create({ login_id: normalizedOpNum, password: tempPassword, user_type: UserType.PATIENT, profile_id: patientProfile._id })

  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Patient created successfully', { patient: patientProfile }))
})

export const reassignPatient = asyncHandler(async (
  req: Request<ReassignPatientInput['params'], {}, ReassignPatientInput['body']>,
  res: Response
) => {
  const { op_num } = req.params
  const { new_doctor_id } = req.body

  const currentDoctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const existingPatientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(existingPatientProfile, currentDoctorUser)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const doctorUser = await User.findOne({ login_id: normalizeLoginId(new_doctor_id), user_type: UserType.DOCTOR })
  if (!doctorUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target doctor not found')
  }

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { assigned_doctor_id: doctorUser._id },
      $push: {
        doctor_change_events: buildDoctorChangeEvent(
          currentDoctorUser._id,
          'DOCTOR_REASSIGNED',
          'Doctor assignment changed',
          `Your case was reassigned to doctor ${new_doctor_id}.`,
          ['assigned_doctor_id']
        )
      }
    },
    { new: true }
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient reassigned successfully', { patient }))
})

export const editPatientDosage = asyncHandler(async (
  req: Request<EditPatientDosageInput['params'], {}, EditPatientDosageInput['body']>,
  res: Response
) => {
  const { op_num } = req.params
  const { prescription } = req.body

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { weekly_dosage: prescription },
      $push: {
        doctor_change_events: buildDoctorChangeEvent(
          doctor._id,
          'DOSAGE_UPDATED',
          'Dosage updated',
          'Your weekly dosage plan was updated by your doctor.',
          ['weekly_dosage']
        )
      }
    },
    { new: true }
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Dosage updated successfully', { patient }))
})

export const getReports = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patient = await PatientProfile.findById(patientUser.profile_id).select('assigned_doctor_id inr_history')
  if (!patient) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (!isDoctorOwnerOfPatient(patient, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Doctor to View The Patient')
  }

  // Convert S3 keys to presigned URLs for each report
  const reportsWithUrls = await Promise.all(
    (patient?.inr_history || []).map(async (report) => {
      const reportObj = report.toObject()
      if (reportObj.file_url) {
        try {
          reportObj.file_url = await getDownloadUrl(reportObj.file_url)
        } catch (error) {
          logger.error('Error generating presigned URL for report', { error, file_url: reportObj.file_url })
          // Keep the original key if presigned URL generation fails
        }
      }
      return reportObj
    })
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'INR reports fetched successfully', { inr_history: reportsWithUrls }))
})

export const updateReport = asyncHandler(async (req: Request<UpdateReportInput['params'], {}, UpdateReportInput['body']>, res: Response) => {
  const { op_num, report_id } = req.params
  const { notes, is_critical } = req.body

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const report = patientProfile.inr_history.id(report_id)
  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }

  if (notes !== undefined) report.notes = notes;
  if (is_critical !== undefined) report.is_critical = is_critical;

  const changedFields: string[] = []
  if (notes !== undefined) changedFields.push('inr_history.notes')
  if (is_critical !== undefined) changedFields.push('inr_history.is_critical')

  patientProfile.doctor_change_events.push(buildDoctorChangeEvent(
    doctor._id,
    'REPORT_UPDATED',
    'Report updated',
    'Your uploaded INR report has new doctor notes or status updates.',
    changedFields
  ) as any)

  await patientProfile.save()

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report updated successfully', { report }))
})

export const updateNextReview = asyncHandler(async (
  req: Request<UpdateNextReviewInput['params'], {}, UpdateNextReviewInput['body']>,
  res: Response
) => {
  const { date } = req.body
  const { op_num } = req.params
  const dateRegex = /^\d{2}-\d{2}-\d{4}$/

  if (typeof date !== 'string' || !dateRegex.test(date)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Date must be in DD-MM-YYYY format')
  }

  const [day, month, year] = date.split('-').map(Number)
  const parsedDate = new Date(year, month - 1, day)

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { 'medical_config.next_review_date': parsedDate },
      $push: {
        doctor_change_events: buildDoctorChangeEvent(
          doctor._id,
          'NEXT_REVIEW_UPDATED',
          'Next review updated',
          `Your next review date was updated to ${date}.`,
          ['medical_config.next_review_date']
        )
      }
    },
    { new: true }
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Next review date updated successfully', { patient }))
})

export const UpdateInstructions = asyncHandler(async (
  req: Request<UpdateInstructionsInput['params'], {}, UpdateInstructionsInput['body']>,
  res: Response
) => {
  const { instructions } = req.body
  const { op_num } = req.params

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { 'medical_config.instructions': instructions },
      $push: {
        doctor_change_events: buildDoctorChangeEvent(
          doctor._id,
          'INSTRUCTIONS_UPDATED',
          'Instructions updated',
          'Your doctor updated your care instructions.',
          ['medical_config.instructions']
        )
      }
    },
    { new: true }
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Instructions updated successfully', { patient }))
})

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const doctor = await User.findById(req.user.user_id).populate('profile_id')
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }

  const doctorProfile = doctor.profile_id as typeof DoctorProfile.prototype
  let profilePictureUrl = null

  if (doctorProfile?.profile_picture_url) {
    try {
      profilePictureUrl = await getDownloadUrl(doctorProfile.profile_picture_url)
    } catch (error) {
      logger.error('Error fetching profile picture URL', { error })
    }
  }

  const patientsCount = await PatientProfile.countDocuments({ assigned_doctor_id: { $in: getDoctorOwnershipIds(doctor) } })

  const response = {
    doctor: {
      ...doctor.toObject(),
      profile_id: {
        ...doctorProfile?.toObject(),
        profile_picture_url: profilePictureUrl
      }
    },
    patients_count: patientsCount
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Profile fetched successfully', response))
})

export const UpdateProfile = asyncHandler(async (req: Request<{}, {}, UpdateProfileInput["body"]>, res: Response) => {
  const { name, contact_number, department } = req.body
  const { user_id } = req.user
  const doctorUser = await User.findById(user_id)
  if (!doctorUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  const updatedProfile = await DoctorProfile.findByIdAndUpdate(
    doctorUser.profile_id,
    { name, contact_number, department },
    { new: true }
  )
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Profile updated successfully'))
})

export const getDoctors = asyncHandler(async (req: Request, res: Response) => {
  const doctors = await User.find({ user_type: UserType.DOCTOR }).populate('profile_id').select('-password -salt').lean()
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Doctors fetched successfully", { doctors }))
})

export const updateReportsInstructions = asyncHandler(async (req: Request<UpdateReportInput["params"], {}, UpdateReportInput["body"]>, res: Response) => {
  const { is_critical, notes } = req.body
  const { report_id, op_num } = req.params

  if (!mongoose.Types.ObjectId.isValid(report_id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid report_id or op_num')
  }

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)

  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Doctor to View The Patient')
  }

  const report = patientProfile.inr_history.id(report_id)
  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }

  if (is_critical !== undefined) report.is_critical = is_critical;
  if (notes !== undefined) report.notes = notes;

  await patientProfile.save()

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report instructions updated successfully'))
})

export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const { report_id, op_num } = req.params

  if (!mongoose.Types.ObjectId.isValid(report_id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid report_id or op_num')
  }

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)

  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Doctor to View The Patient')
  }

  const report = patientProfile.inr_history.id(report_id)
  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }
  const downloadUrl = await getDownloadUrl(report.file_url)
  const reportResponse = { ...report.toObject(), file_url: downloadUrl }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report fetched successfully', { report: reportResponse }))
})

export const updateProfilePicture = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Image is required for setting up profile picture")
  }
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid file type. Only PNG, JPEG, JPG, and WEBP images are allowed')
  }
  const { user_id } = req.user

  let fileUrl = ''
  try {
    fileUrl = await uploadFile("profiles", req.file)
  } catch (error) {
    logger.error("Error While Uploading profile to filebase", { error })
    throw new ApiError(StatusCodes.INSUFFICIENT_STORAGE, "Error While Uploading report to cloud")
  }

  const user = await User.findById(user_id)
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  await DoctorProfile.findByIdAndUpdate(user.profile_id, { profile_picture_url: fileUrl }, { new: true })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Profile Picture successfully changed"))
})
