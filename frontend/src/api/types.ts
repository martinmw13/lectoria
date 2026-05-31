import type { components } from './schema';

type Schemas = components['schemas'];

// Domain model + response DTOs keep their backend names on the frontend (one name
// per contract — no aliases). Each is a named OpenAPI component, so we project the
// direct form rather than indexed access. These are the single source of truth for
// API shapes; the hand-written mirror in client.ts is gone.

// NCM domain model.
export type NCM = Schemas['NCM'];
export type BookMap = Schemas['BookMap'];
export type ChapterAnalysis = Schemas['ChapterAnalysis'];
export type ChapterSummary = Schemas['ChapterSummary'];
export type Scene = Schemas['Scene'];
export type Character = Schemas['Character'];

// Ingestion model (GET /chapters).
export type ChaptersData = Schemas['ChaptersData'];
export type Chapter = Schemas['Chapter'];
export type Paragraph = Schemas['Paragraph'];

// Response DTOs.
export type BookResponse = Schemas['BookResponse'];
export type MusicPreset = Schemas['MusicPreset'];
export type SceneTrackResponse = Schemas['SceneTrackResponse'];
export type DetailedSceneTrackResponse = Schemas['DetailedSceneTrackResponse'];
export type CrossfadeResponse = Schemas['CrossfadeResponse'];
