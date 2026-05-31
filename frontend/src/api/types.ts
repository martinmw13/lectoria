import type { components } from './schema';

type Schemas = components['schemas'];

// Response DTOs keep their backend names on the frontend (one name per contract — no aliases).
export type MusicPreset = Schemas['MusicPreset'];
// NCM / Scene / ChapterAnalysis / Character / BookMap / ChapterSummary / ChaptersData / Chapter / Paragraph are added in the migration slice.
