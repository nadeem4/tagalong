-- A job's step log moves from job_activity to job_steps; same columns, same key, same paging.
ALTER TABLE job_activity RENAME TO job_steps;
DROP INDEX job_activity_rev;
CREATE INDEX job_steps_rev ON job_steps(job_id, rev);
