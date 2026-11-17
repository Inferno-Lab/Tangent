-- kind: expand
-- Morning and afternoon registers (one-shot plan 4.3): a roll call is for the whole day, or for one half of it when the
-- school keeps two registers. 0046 drops the old one-a-day index once every runner writes the part.
ALTER TABLE "attendance_sessions" ADD COLUMN IF NOT EXISTS "part" text NOT NULL DEFAULT 'day';
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_sessions_part_uq" ON "attendance_sessions" ("class_id", "date", "part");

-- One line per child per day, whichever registers the school keeps: the same mark both halves is that mark; present for one
-- half is a half day; otherwise the more serious of the two (absent before leave). Per-day screens read this; percentages
-- keep counting every register, as schools that keep two count sessions.
CREATE OR REPLACE VIEW "attendance_days" AS
  SELECT m.student_id, s.class_id, s.date,
    CASE WHEN count(DISTINCT m.status) = 1 THEN min(m.status)
         WHEN bool_or(m.status IN ('present', 'late', 'half_day')) THEN 'half_day'
         ELSE min(m.status) END AS status,
    CASE WHEN count(DISTINCT coalesce(m.code, m.status)) = 1 THEN min(m.code) END AS code,
    max(s.submitted_at) AS submitted_at, count(*)::int AS registers
  FROM attendance_marks m JOIN attendance_sessions s ON s.id = m.session_id
  GROUP BY m.student_id, s.class_id, s.date;
