-- Where each job part ran: "brain" or a node's body id. A saved session resumes only there.
ALTER TABLE work_job ADD COLUMN host TEXT NOT NULL DEFAULT 'brain';
