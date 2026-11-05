// Bring your own key for pictures. Shown where the daily free pictures
// (or our credits) ran out, and when a typed key could not draw. The key
// goes to tab memory only (reader-key.ts) and the picture is asked again.
"use client";

import { ByokStep } from "../home/byok";
import { setSessionKey } from "../leer/reader-key";

export const PICTURE_BYOK_COPY = {
  note: "With your own Meta key you can keep making pictures today.",
  privacy: "Your key stays in this tab's memory. We never store or log it.",
  action: "Keep picturing",
} as const;

export function PictureByok({ onKey }: { onKey: () => void }) {
  return (
    <div className="picture-byok">
      <ByokStep
        note={PICTURE_BYOK_COPY.note}
        privacyNote={PICTURE_BYOK_COPY.privacy}
        actionLabel={PICTURE_BYOK_COPY.action}
        metaOnly
        onSubmit={(key) => {
          setSessionKey(key);
          onKey();
        }}
      />
    </div>
  );
}
