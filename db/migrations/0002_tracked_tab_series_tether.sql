ALTER TABLE tracked_tab ADD COLUMN tether_mode TEXT NOT NULL DEFAULT 'loose';
ALTER TABLE tracked_tab ADD COLUMN series_pattern TEXT;
