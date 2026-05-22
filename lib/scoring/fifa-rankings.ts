// FIFA world ranking for the 48 WC 2026 qualifiers — canonical TS source.
//
// Used to score the dark-horse prediction: a user picks any team; if their
// team reaches QF, they earn `fifa_ranking` points (1..48). So picking the
// worst-ranked team that makes QF wins 48 pts; picking the favourite wins 1.
//
// The seed block at the bottom of
// supabase/migrations/0005_more_tournament_props.sql writes these into
// teams.fifa_ranking; the SQL scoring function reads from that column. Both
// must stay in sync — when you edit this file, add a new migration that
// updates the matching UPDATE statements (migrations are append-only).
//
// TODO: confirm exact ranks closer to kickoff; teams that don't end up
// qualifying will simply remain NULL in the DB and score 0 if anyone picks
// them as their dark horse.

export const FIFA_RANKINGS_2026: Record<string, number> = {
  ARG:  1, FRA:  2, ESP:  3, ENG:  4, BRA:  5,
  NED:  6, POR:  7, BEL:  8, GER:  9, CRO: 10,
  COL: 11, URU: 12, JPN: 13, MAR: 14, USA: 15,
  SUI: 16, SEN: 17, MEX: 18, IRN: 19, DEN: 20,
  KOR: 21, AUT: 22, AUS: 23, ECU: 24, UKR: 25,
  CRC: 26, CIV: 27, POL: 28, EGY: 29, NOR: 30,
  NGA: 31, CAN: 32, ALG: 33, SCO: 34, SRB: 35,
  ROU: 36, CZE: 37, PAR: 38, QAT: 39, KSA: 40,
  SVK: 41, COD: 42, TUN: 43, JAM: 44, UZB: 45,
  JOR: 46, NZL: 47, CPV: 48,
};
