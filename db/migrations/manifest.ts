import initialSql from "./0001_initial.sql?raw";
import seriesTetherSql from "./0002_tracked_tab_series_tether.sql?raw";

export type Migration = { version: number; name: string; checksum: string; sql: string };

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    checksum: "sha256:00c7c10358ed77524a47d7d7d00c5e7273e2ab57ad888cf3edc6379e2689f70a",
    sql: initialSql,
  },
  {
    version: 2,
    name: "tracked_tab_series_tether",
    checksum: "sha256:6f13f9b60e0bce332d38be62138346e0c04dad5427fd659b47d87f0da0461eaa",
    sql: seriesTetherSql,
  },
];
