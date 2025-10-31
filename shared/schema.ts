// Reference: Replit Auth integration blueprint
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
    user: any;
  }
}

// ==================== AUTH TABLES (Required for Replit Auth) ====================

// Session storage table - Required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - Required for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 20 }).notNull().default('analyst'), // admin, analyst, supervisor, auditor
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ==================== FORENSICS TABLES ====================

// Cases table
export const cases = pgTable("cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseNumber: varchar("case_number", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default('open'), // open, in_progress, closed, archived
  priority: varchar("priority", { length: 20 }).notNull().default('medium'), // low, medium, high, critical
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const casesRelations = relations(cases, ({ one, many }) => ({
  assignedTo: one(users, {
    fields: [cases.assignedToId],
    references: [users.id],
    relationName: "assignedCases",
  }),
  createdBy: one(users, {
    fields: [cases.createdById],
    references: [users.id],
    relationName: "createdCases",
  }),
  evidence: many(evidence),
  analysisResults: many(analysisResults),
}));

// Evidence table
export const evidence = pgTable("evidence", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: 'cascade' }),
  evidenceNumber: varchar("evidence_number", { length: 50 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // image, video, document, mobile_data, network_capture, etc.
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: integer("file_size"), // in bytes
  filePath: text("file_path"), // storage path
  sha256Hash: varchar("sha256_hash", { length: 64 }).notNull(),
  description: text("description"),
  collectedBy: varchar("collected_by").notNull().references(() => users.id),
  collectedAt: timestamp("collected_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  case: one(cases, {
    fields: [evidence.caseId],
    references: [cases.id],
  }),
  collector: one(users, {
    fields: [evidence.collectedBy],
    references: [users.id],
  }),
  custodyChain: many(chainOfCustody),
  analysisResults: many(analysisResults),
}));

// Chain of Custody table
export const chainOfCustody = pgTable("chain_of_custody", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  evidenceId: varchar("evidence_id").notNull().references(() => evidence.id, { onDelete: 'cascade' }),
  action: varchar("action", { length: 100 }).notNull(), // collected, transferred, analyzed, stored, etc.
  userId: varchar("user_id").notNull().references(() => users.id),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  location: varchar("location", { length: 255 }),
  notes: text("notes"),
  ipAddress: varchar("ip_address", { length: 45 }),
});

export const chainOfCustodyRelations = relations(chainOfCustody, ({ one }) => ({
  evidence: one(evidence, {
    fields: [chainOfCustody.evidenceId],
    references: [evidence.id],
  }),
  user: one(users, {
    fields: [chainOfCustody.userId],
    references: [users.id],
  }),
}));

// Analysis Results table (for all forensic modules)
export const analysisResults = pgTable("analysis_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: 'cascade' }),
  evidenceId: varchar("evidence_id").references(() => evidence.id, { onDelete: 'cascade' }),
  moduleType: varchar("module_type", { length: 50 }).notNull(), // ai_deepfake, social_media, image_forensics, etc.
  analysisType: varchar("analysis_type", { length: 100 }).notNull(),
  results: jsonb("results").notNull(), // JSON structure varies by module
  confidence: integer("confidence"), // 0-100
  flagged: boolean("flagged").default(false),
  analyzedBy: varchar("analyzed_by").notNull().references(() => users.id),
  analyzedAt: timestamp("analyzed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const analysisResultsRelations = relations(analysisResults, ({ one }) => ({
  case: one(cases, {
    fields: [analysisResults.caseId],
    references: [cases.id],
  }),
  evidence: one(evidence, {
    fields: [analysisResults.evidenceId],
    references: [evidence.id],
  }),
  analyzer: one(users, {
    fields: [analysisResults.analyzedBy],
    references: [users.id],
  }),
}));

// Audit Log table
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }), // case, evidence, analysis, etc.
  resourceId: varchar("resource_id"),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => [
  index("idx_audit_logs_user").on(table.userId),
  index("idx_audit_logs_timestamp").on(table.timestamp),
]);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// ==================== INSERT SCHEMAS ====================

export const insertCaseSchema = createInsertSchema(cases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEvidenceSchema = createInsertSchema(evidence).omit({
  id: true,
  createdAt: true,
});

export const insertAnalysisResultSchema = createInsertSchema(analysisResults).omit({
  id: true,
  createdAt: true,
});

export const insertChainOfCustodySchema = createInsertSchema(chainOfCustody).omit({
  id: true,
});

// ==================== TYPES ====================

export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof cases.$inferSelect;

export type InsertEvidence = z.infer<typeof insertEvidenceSchema>;
export type Evidence = typeof evidence.$inferSelect;

export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
export type AnalysisResult = typeof analysisResults.$inferSelect;

export type InsertChainOfCustody = z.infer<typeof insertChainOfCustodySchema>;
export type ChainOfCustody = typeof chainOfCustody.$inferSelect;

export type AuditLog = typeof auditLogs.$inferSelect;