import mongoose from "mongoose";
import { DosageScheduleSchema, InrLogSchema, HealthLogSchema } from "./index";

const DoctorChangeEventSchema = new mongoose.Schema({
  changed_by_doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  change_type: {
    type: String,
    enum: ['DOCTOR_REASSIGNED', 'DOSAGE_UPDATED', 'REPORT_UPDATED', 'NEXT_REVIEW_UPDATED', 'INSTRUCTIONS_UPDATED'],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  changed_fields: {
    type: [String],
    default: [],
  },
  is_read: {
    type: Boolean,
    default: false,
    index: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  }
}, { _id: true });

const PatientProfileSchema = new mongoose.Schema({
  assigned_doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  demographics: {
    name: { type: String, required: [true, "Name is required"] },
    age: { type: Number },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"]
    },
    phone: { type: String },
    next_of_kin: {
      name: { type: String },
      relation: { type: String },
      phone: { type: String }
    }
  },
  medical_config: {
    diagnosis: { type: String },
    therapy_drug: { type: String },
    therapy_start_date: { type: Date },
    target_inr: {
      min: { type: Number, default: 2.0 },
      max: { type: Number, default: 3.0 }
    },
    next_review_date: { type: Date },
    instructions: { type: [String] },
    taken_doses: { type: [Date] }
  },
  medical_history: [{
    diagnosis: { type: String },
    duration_value: { type: Number },
    duration_unit: { type: String, enum: ['Days', 'Weeks', 'Months', 'Years'] },
  }],
  weekly_dosage: DosageScheduleSchema,
  inr_history: [InrLogSchema],
  health_logs: [HealthLogSchema],
  account_status: {
    type: String,
    enum: ['Active', 'Discharged', 'Deceased'],
    default: 'Active'
  },
  profile_picture_url: { type: String },
  doctor_change_events: {
    type: [DoctorChangeEventSchema],
    default: [],
  },
}, { timestamps: true });

export interface PatientProfileDocument extends mongoose.Document, mongoose.InferSchemaType<typeof PatientProfileSchema> { }

export default mongoose.model<PatientProfileDocument>("PatientProfile", PatientProfileSchema)
