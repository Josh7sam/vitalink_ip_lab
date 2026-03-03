import { Request, Response } from 'express'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { PatientProfile, User } from '@alias/models'
import { UserType } from '@alias/validators'
import type {
	DoctorUpdatesQueryInput,
	MarkDoctorUpdateReadInput,
	ReportInput,
	TakeDosageInput,
	UpdateHealthLog,
	UpdateProfileInput
} from '@alias/validators/patient.validator'
import logger from '@alias/utils/logger'
import { uploadFile, getDownloadUrl } from '@alias/utils/fileUpload'

const getPatientUserOrThrow = async (userId: string, notFoundMessage = 'Patient not found') => {
	const patientUser = await User.findById(userId)
	if (!patientUser || patientUser.user_type !== UserType.PATIENT) {
		throw new ApiError(StatusCodes.NOT_FOUND, notFoundMessage)
	}
	return patientUser
}

const getPatientProfileOrThrow = async (profileId: unknown, notFoundMessage = 'Patient profile not found') => {
	const patientProfile = await PatientProfile.findById(profileId)
	if (!patientProfile) {
		throw new ApiError(StatusCodes.NOT_FOUND, notFoundMessage)
	}
	return patientProfile
}

const getDoctorChangeEventsFromProfile = (patientProfile: any) => {
	const events = Array.isArray(patientProfile?.doctor_change_events)
		? patientProfile.doctor_change_events
		: []

	return events.sort((a: any, b: any) => {
		const aTime = new Date(a?.created_at || 0).getTime()
		const bTime = new Date(b?.created_at || 0).getTime()
		return bTime - aTime
	})
}

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
	const { user_id } = req.user
	const user = await User.findById(user_id).populate({
		path: 'profile_id',
		populate: {
			path: 'assigned_doctor_id',
			populate: {
				path: 'profile_id'
			}
		}
	})
	if (!user || user.user_type !== UserType.PATIENT) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
	}

	const profile = user.profile_id as any
	const doctorChangeEvents = getDoctorChangeEventsFromProfile(profile)
	const unreadDoctorUpdates = doctorChangeEvents.filter((event: any) => !event?.is_read).length

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Profile fetched successfully', {
		patient: user,
		doctor_updates: {
			unread_count: unreadDoctorUpdates,
			latest: doctorChangeEvents[0] ?? null,
		}
	}))
})

export const getReport = asyncHandler(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new ApiError(StatusCodes.UNAUTHORIZED, 'Unauthorized')
	}

	const patientUser = await getPatientUserOrThrow(req.user.user_id)
	const patient = await PatientProfile.findById(patientUser.profile_id).select('inr_history health_logs weekly_dosage medical_config')
	if (!patient) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
	}

	// Convert patient to plain object and generate presigned URLs for reports
	const patientData = patient.toObject()
	if (patientData.inr_history && Array.isArray(patientData.inr_history)) {
		const reportsWithUrls = await Promise.all(
			patientData.inr_history.map(async (report: any) => {
				if (report.file_url) {
					try {
						report.file_url = await getDownloadUrl(report.file_url)
					} catch (error) {
						logger.error('Error generating presigned URL for report', { error })
					}
				}
				return report
			})
		)
		patientData.inr_history = reportsWithUrls as any
	}

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report fetched', { report: patientData }))
})

export const submitReport = asyncHandler(async (req: Request<{}, {}, ReportInput['body']>, res: Response) => {
	const { user_id } = req.user
	const patientUser = await getPatientUserOrThrow(user_id)

	const { inr_value, test_date } = req.body
	const parsed_inr_value = parseFloat(inr_value)
	if (isNaN(parsed_inr_value)) {
		throw new ApiError(StatusCodes.BAD_REQUEST, 'INR value should be a valid number')
	}

	// Parse the test_date if it's a string (Zod transformation doesn't mutate req.body)
	const parsedTestDate = test_date instanceof Date ? test_date : parseDDMMYYYY(test_date)

	const file = (req as any).file as Express.Multer.File | undefined

	if (file) {
		const allowed = ['application/pdf', 'image/png', 'image/jpeg']
		if (!allowed.includes(file.mimetype)) {
			throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid file type. Only PDF, PNG, JPEG allowed')
		}
	}
	let fileUrl = ''
	if (file) {
		try {
			fileUrl = await uploadFile("uploads", file)
		} catch (error) {
			logger.error("Error While Uploading File to filebase", { error })
			throw new ApiError(StatusCodes.INSUFFICIENT_STORAGE, "Error While Uploading report to cloud")
		}
	}

	const patient = await PatientProfile.findByIdAndUpdate(
		patientUser.profile_id,
		{
			$push: {
				inr_history: {
					test_date: parsedTestDate,
					uploaded_at: new Date(),
					inr_value: parsed_inr_value,
					file_url: fileUrl,
				},
			},
		},
		{ new: true }
	)
	if (!patient) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
	}

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report submitted', { patient }))
})

// TODO: Need to Review The Routes and Logic After This Later
export const missedDoses = asyncHandler(async (req: Request<{}, {}, {}>, res: Response) => {
	const patientUser = await getPatientUserOrThrow(req.user.user_id)
	const patient = await getPatientProfileOrThrow(patientUser.profile_id)

	const therapyStart = patient.medical_config?.therapy_start_date
	const dosage = patient.weekly_dosage

	if (!therapyStart || !dosage) {
		throw new ApiError(StatusCodes.BAD_REQUEST, 'Therapy start date or dosage schedule is missing')
	}

	// Convert Mongoose document to plain object
	const dosagePlain: Record<string, number> = (dosage as any)?.toObject ? (dosage as any).toObject() : JSON.parse(JSON.stringify(dosage))

	const medicationDates = getMedicationDates(therapyStart, dosagePlain)
	const takenDates: (Date | string)[] = (patient.medical_config?.taken_doses || []).map((d: any) =>
		d instanceof Date ? d : new Date(d)
	)
	const missed = findMissedDoses(medicationDates, takenDates)

	const today = new Date()
	const sevenDaysAgo = new Date()
	sevenDaysAgo.setDate(today.getDate() - 7)

	const recent_missed_doses: string[] = []
	const remaining_missed: string[] = []
	missed.forEach((d) => {
		const [day, month, year] = d.split('-').map(Number)
		const dateObj = new Date(year, month - 1, day)
		if (dateObj >= sevenDaysAgo && dateObj <= today) {
			recent_missed_doses.push(d)
		} else {
			remaining_missed.push(d)
		}
	})

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Missed doses calculated',
		{ recent_missed_doses, missed_doses: remaining_missed }))
})

export const takeDosage = asyncHandler(async (req: Request<{}, {}, TakeDosageInput['body']>, res: Response) => {
	const patientUser = await getPatientUserOrThrow(req.user.user_id)

	const { date } = req.body
	const parsedDate = date instanceof Date ? date : parseDDMMYYYY(date)

	// Normalize the date to midnight for consistent comparison
	const normalizedDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate())

	// Get the patient profile
	const patient = await getPatientProfileOrThrow(patientUser.profile_id)

	// Check if this date is already marked as taken
	const takenDoses = patient.medical_config?.taken_doses || []
	const alreadyTaken = takenDoses.some((takenDate: Date) => {
		const normalizedTaken = new Date(takenDate.getFullYear(), takenDate.getMonth(), takenDate.getDate())
		return normalizedTaken.getTime() === normalizedDate.getTime()
	})

	if (alreadyTaken) {
		throw new ApiError(StatusCodes.BAD_REQUEST, 'This dose has already been marked as taken')
	}

	// Add the dose to taken_doses using $addToSet to prevent duplicates
	const updatedPatient = await PatientProfile.findByIdAndUpdate(
		patientUser.profile_id,
		{
			$addToSet: {
				'medical_config.taken_doses': normalizedDate,
			},
		},
		{ new: true }
	)

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Dosage logged successfully', { patient: updatedPatient }))
})

export const getDosageCalendar = asyncHandler(async (req: Request, res: Response) => {
	const patientUser = await getPatientUserOrThrow(req.user.user_id)
	const patient = await getPatientProfileOrThrow(patientUser.profile_id)

	const therapyStart = patient.medical_config?.therapy_start_date
	const dosage = patient.weekly_dosage

	if (!therapyStart || !dosage) {
		throw new ApiError(StatusCodes.BAD_REQUEST, 'Therapy start date or dosage schedule is missing')
	}

	// Parse query parameters
	const monthsParam = req.query.months ? parseInt(req.query.months as string) : 3
	const months = Math.min(Math.max(monthsParam, 1), 6) // Limit between 1 and 6 months
	const startDateParam = req.query.start_date as string | undefined

	// Calculate date range
	let rangeEnd: Date
	let rangeStart: Date

	if (startDateParam) {
		// If start_date provided, calculate from there
		rangeEnd = parseDDMMYYYY(startDateParam)
		rangeStart = new Date(rangeEnd)
		rangeStart.setMonth(rangeStart.getMonth() - months)
	} else {
		// Default: from today backwards
		rangeEnd = new Date()
		rangeStart = new Date()
		rangeStart.setMonth(rangeStart.getMonth() - months)
	}

	// Don't go before therapy start date
	const therapyStartDate = new Date(therapyStart)
	if (rangeStart < therapyStartDate) {
		rangeStart = therapyStartDate
	}

	// Convert Mongoose document to plain object
	const dosagePlain: Record<string, number> = (dosage as any)?.toObject ? (dosage as any).toObject() : JSON.parse(JSON.stringify(dosage))

	// Get all scheduled medication dates in the range
	const allMedicationDates = getMedicationDatesInRange(rangeStart, rangeEnd, dosagePlain)

	// Get taken doses
	const takenDoses: Date[] = (patient.medical_config?.taken_doses || []).map((d: any) =>
		d instanceof Date ? d : new Date(d)
	)

	// Build calendar data
	const calendarData = allMedicationDates.map(({ date, dayOfWeek }) => {
		const dateStr = formatDDMMYYYY(date)
		const isTaken = takenDoses.some(takenDate => {
			return formatDDMMYYYY(takenDate) === dateStr
		})

		const scheduledDosage = dosagePlain[dayOfWeek] || 0

		return {
			date: dateStr,
			status: isTaken ? 'taken' : (date <= new Date() ? 'missed' : 'scheduled'),
			dosage: scheduledDosage,
			day_of_week: dayOfWeek
		}
	})

	res.status(StatusCodes.OK).json(
		new ApiResponse(StatusCodes.OK, 'Calendar data fetched', {
			calendar_data: calendarData,
			date_range: {
				start: formatDDMMYYYY(rangeStart),
				end: formatDDMMYYYY(rangeEnd),
			},
			therapy_start: formatDDMMYYYY(therapyStartDate)
		})
	)
})

export const updateProfile = asyncHandler(async (req: Request<{}, {}, UpdateProfileInput['body']>, res: Response) => {
	const { user_id } = req.user
	const { demographics, medical_history, medical_config } = req.body

	const user = await User.findById(user_id)
	if (!user || user.user_type !== UserType.PATIENT) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
	}

	const updateData: any = {}

	if (demographics) {
		if (demographics.name) updateData['demographics.name'] = demographics.name
		if (demographics.age !== undefined) updateData['demographics.age'] = demographics.age
		if (demographics.gender) updateData['demographics.gender'] = demographics.gender
		if (demographics.phone) updateData['demographics.phone'] = demographics.phone
		if (demographics.next_of_kin) {
			if (demographics.next_of_kin.name) updateData['demographics.next_of_kin.name'] = demographics.next_of_kin.name
			if (demographics.next_of_kin.relation) updateData['demographics.next_of_kin.relation'] = demographics.next_of_kin.relation
			if (demographics.next_of_kin.phone) updateData['demographics.next_of_kin.phone'] = demographics.next_of_kin.phone
		}
	}

	if (medical_history) {
		updateData.medical_history = medical_history
	}

	if (medical_config) {
		if (medical_config.therapy_start_date) updateData['medical_config.therapy_start_date'] = medical_config.therapy_start_date
	}

	const updatedProfile = await PatientProfile.findByIdAndUpdate(
		user.profile_id,
		{ $set: updateData },
		{ new: true, runValidators: true }
	)

	if (!updatedProfile) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
	}

	res.status(StatusCodes.OK).json(
		new ApiResponse(StatusCodes.OK, 'Profile updated successfully', { profile: updatedProfile })
	)
})

export const updateHealthLogs = asyncHandler(async (req: Request<{}, {}, UpdateHealthLog["body"]>, res: Response) => {
	const { type, description } = req.body
	const { user_id } = req.user

	const user = await getPatientUserOrThrow(user_id)
	const patientprofile = await PatientProfile.findByIdAndUpdate(user.profile_id,
		[{
			$set: {
				health_logs: {
					$concatArrays: [
						{ $filter: { input: "$health_logs", as: "log", cond: { $ne: ["$$log.type", type] } } },
						[{ type: type, description: description.trim(), date: new Date() }]
					]
				}
			}
		}],
		{ new: true, updatePipeline: true }
	);
	if (!patientprofile) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
	}

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Health Logs Updated Suucessfully"))
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

	const user = await getPatientUserOrThrow(user_id)

	await PatientProfile.findByIdAndUpdate(user.profile_id, { profile_picture_url: fileUrl }, { new: true })
	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Profile Picture successfully changed"))
})


export const getDoctorUpdates = asyncHandler(async (
	req: Request<{}, {}, {}, DoctorUpdatesQueryInput['query']>,
	res: Response
) => {
	const patientUser = await getPatientUserOrThrow(req.user.user_id)
	const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)

	const unreadOnly = req.query.unread_only === 'true'
	const parsedLimit = req.query.limit ? parseInt(req.query.limit, 10) : 20
	const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20

	let events = getDoctorChangeEventsFromProfile(patientProfile)
	if (unreadOnly) {
		events = events.filter((event: any) => !event?.is_read)
	}

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor updates fetched successfully', {
		updates: events.slice(0, limit)
	}))
})

export const markDoctorUpdateAsRead = asyncHandler(async (
	req: Request<MarkDoctorUpdateReadInput['params']>,
	res: Response
) => {
	const patientUser = await getPatientUserOrThrow(req.user.user_id)
	const { event_id } = req.params

	const patientProfile = await PatientProfile.findOneAndUpdate(
		{ _id: patientUser.profile_id, 'doctor_change_events._id': event_id },
		{ $set: { 'doctor_change_events.$.is_read': true } },
		{ new: true }
	)

	if (!patientProfile) {
		throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor update not found')
	}

	res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor update marked as read'))
})

function parseDDMMYYYY(date: string | Date): Date {
	const regex = /^\d{2}-\d{2}-\d{4}$/
	if (date instanceof Date) return date
	if (typeof date !== 'string' || !regex.test(date)) {
		throw new ApiError(StatusCodes.BAD_REQUEST, 'Date must be in DD-MM-YYYY format')
	}
	const [day, month, year] = date.split('-').map(Number)
	const parsed = new Date(year, month - 1, day)
	if (
		parsed.getFullYear() !== year ||
		parsed.getMonth() !== month - 1 ||
		parsed.getDate() !== day
	) {
		throw new ApiError(StatusCodes.BAD_REQUEST, 'Date must be a valid calendar date in DD-MM-YYYY format')
	}
	return parsed
}

function formatDDMMYYYY(d: Date): string {
	const dd = `${d.getDate()}`.padStart(2, '0')
	const mm = `${d.getMonth() + 1}`.padStart(2, '0')
	const yyyy = d.getFullYear()
	return `${dd}-${mm}-${yyyy}`
}

function getMedicationDates(startDate: Date, weeklyDosage: Record<string, number>): string[] {
	const daysMap: Record<string, number> = {
		sunday: 0,
		monday: 1,
		tuesday: 2,
		wednesday: 3,
		thursday: 4,
		friday: 5,
		saturday: 6,
	}

	const targetDays = Object.entries(weeklyDosage)
		.filter(([, val]) => typeof val === 'number' && val > 0)
		.map(([day]) => daysMap[day])
		.filter((v) => v !== undefined)

	const start = startDate instanceof Date ? startDate : new Date(startDate)
	const today = new Date()
	const dates: string[] = []
	let current = new Date(start)

	while (current <= today) {
		if (targetDays.includes(current.getDay())) {
			dates.push(formatDDMMYYYY(current))
		}
		current.setDate(current.getDate() + 1)
	}

	return dates
}

function getMedicationDatesInRange(
	startDate: Date,
	endDate: Date,
	weeklyDosage: Record<string, number>
): Array<{ date: Date; dayOfWeek: string }> {
	const daysMap: Record<number, string> = {
		0: 'sunday',
		1: 'monday',
		2: 'tuesday',
		3: 'wednesday',
		4: 'thursday',
		5: 'friday',
		6: 'saturday',
	}

	const targetDays = Object.entries(weeklyDosage)
		.filter(([, val]) => typeof val === 'number' && val > 0)
		.map(([day]) => day)

	const dates: Array<{ date: Date; dayOfWeek: string }> = []
	let current = new Date(startDate)

	while (current <= endDate) {
		const dayOfWeek = daysMap[current.getDay()]
		if (targetDays.includes(dayOfWeek)) {
			dates.push({
				date: new Date(current),
				dayOfWeek
			})
		}
		current.setDate(current.getDate() + 1)
	}

	return dates
}

function findMissedDoses(medicationDates: string[], takenDates: Array<Date | string | unknown>): string[] {
	const takenFormatted = new Set(
		(takenDates || []).map((d) => {
			const dt = d instanceof Date
				? d
				: typeof d === 'string' || typeof d === 'number'
					? new Date(d)
					: new Date(String(d))
			return formatDDMMYYYY(dt)
		})
	)

	const missed = medicationDates.filter((d) => !takenFormatted.has(d))
	missed.sort((a, b) => {
		const [ad, am, ay] = a.split('-').map(Number)
		const [bd, bm, by] = b.split('-').map(Number)
		return new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()
	})
	return missed
}
