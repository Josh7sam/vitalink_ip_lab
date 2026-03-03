import { z } from 'zod'
import { HealthLog } from '.'

const ddmmyyyy = z.string('Date should be a string')
    .regex(/^\d{2}-\d{2}-\d{4}$/, 'Date must be in DD-MM-YYYY format')
    .transform((val) => {
        const [day, month, year] = val.split('-').map(Number)
        return new Date(year, month - 1, day)
    })

export const reportSchema = z.object({
    body: z.object({
        inr_value: z.string('INR value should be a string').nonempty("Inr Value Should not be empty"),
        test_date: ddmmyyyy,
    })
})
export type ReportInput = z.infer<typeof reportSchema>

export const takeDosageSchema = z.object({
    body: z.object({
        date: ddmmyyyy,
    })
})
export type TakeDosageInput = z.infer<typeof takeDosageSchema>


export const updateHealthLogSchema = z.object({
    body: z.object({
        type: z.enum(HealthLog, "The Health Log Type should be a valid One"),
        description: z.string("Description Should be a string")
    })
})

export type UpdateHealthLog = z.infer<typeof updateHealthLogSchema>


export const updateProfileSchema = z.object({
    body: z.object({
        demographics: z.object({
            name: z.string().min(1, "Name is required").optional(),
            age: z.number().int().positive().optional(),
            gender: z.enum(["Male", "Female", "Other"]).optional(),
            phone: z.string().optional(),
            next_of_kin: z.object({
                name: z.string().optional(),
                relation: z.string().optional(),
                phone: z.string().optional()
            }).optional()
        }).optional(),
        medical_history: z.array(z.object({
            diagnosis: z.string().optional(),
            duration_value: z.number().positive().optional(),
            duration_unit: z.enum(['Days', 'Weeks', 'Months', 'Years']).optional()
        })).optional(),
        medical_config: z.object({
            therapy_start_date: z.union([
                z.date(),
                ddmmyyyy
            ]).refine(
                (date) => date <= new Date(),
                { message: "Therapy start date cannot be in the future" }
            ).optional()
        }).strict().optional()
    }).strict()
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const doctorUpdatesQuerySchema = z.object({
    query: z.object({
        unread_only: z.enum(['true', 'false']).optional(),
        limit: z.string().regex(/^\d+$/, 'Limit should be a valid number').optional(),
    }).strict()
})

export type DoctorUpdatesQueryInput = z.infer<typeof doctorUpdatesQuerySchema>

export const markDoctorUpdateReadSchema = z.object({
    params: z.object({
        event_id: z.string('event_id should be a valid string').regex(/^[a-f\d]{24}$/i, 'event_id must be a valid ObjectId')
    }).strict()
})

export type MarkDoctorUpdateReadInput = z.infer<typeof markDoctorUpdateReadSchema>
