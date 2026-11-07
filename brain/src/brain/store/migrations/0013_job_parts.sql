
    CREATE TABLE job_parts(
        job_id TEXT NOT NULL,
        id TEXT NOT NULL,
        agent TEXT, task TEXT, state TEXT, reason TEXT, progress TEXT,
        session_id TEXT, report TEXT,
        reported INTEGER NOT NULL DEFAULT 0,
        started_at TEXT, ended_at TEXT, folder TEXT,
        PRIMARY KEY(job_id, id)
    );
    INSERT INTO job_parts(job_id, id, agent, task, state, reason, progress, session_id, report,
                          reported, started_at, ended_at, folder)
        SELECT id, 'p1', agent, task, state, reason, progress, session_id, result,
               COALESCE(reported, 0), started_at, ended_at, folder FROM jobs ORDER BY rowid;
    CREATE TABLE jobs_new(
        id TEXT PRIMARY KEY,
        task TEXT, folder TEXT, mode TEXT, state TEXT,
        started_at TEXT, ended_at TEXT, parent_job TEXT, watch TEXT,
        title TEXT, scout_result TEXT, closed_at TEXT
    );
    INSERT INTO jobs_new(id, task, folder, mode, state, started_at, ended_at, parent_job, watch,
                         closed_at)
        SELECT id, task, folder, mode, state, started_at, ended_at, parent_job, watch,
               CASE WHEN state = 'running' THEN NULL ELSE ended_at END FROM jobs ORDER BY rowid;
    DROP TABLE jobs;
    ALTER TABLE jobs_new RENAME TO jobs;
    ALTER TABLE job_activity ADD COLUMN part TEXT NOT NULL DEFAULT 'p1';
    ALTER TABLE job_activity ADD COLUMN source TEXT;
    