import Image from "next/image";
import face from "@/public/brand/denise/face.png";
import point from "@/public/brand/denise/point.png";
import think from "@/public/brand/denise/think.png";
import wave from "@/public/brand/denise/wave.png";

// Denise, the AI assistant (short for DNIS, Digital Navigator of Issues and
// Scheduling). While she works she's one small avatar, her face, the same
// everywhere (`DeniseAvatar`, `DeniseFace`); her full illustration (waving)
// is kept for the moments that are about her: signing in, the welcome, and
// empty states (`DenisePose`). The thinking and pointing drawings are only
// on Meet Denise (Settings → Denise), the page about her, never while she
// works.
export type Pose = "wave" | "think" | "point";

const POSE_LABELS: Record<Pose, string> = {
  wave: "Denise waving",
  think: "Denise thinking",
  point: "Denise pointing at a suggestion",
};

// Her face, in one of four sizes: 24px wherever she speaks (her messages,
// cards and notes), 20px inside a control or a line of small text, and
// 36px or 46px only on the buttons that open her.
export type FaceSize = 20 | 24 | 36 | 46;

export function DeniseFace({ size = 24, className = "" }: { size?: FaceSize; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 overflow-hidden rounded-full bg-denise-50 ring-2 ring-denise-200 ${className}`}
      style={{ width: size, height: size }}
    >
      <Image src={face} alt="" width={size} height={size} className="size-full object-cover" />
    </span>
  );
}

// Her avatar beside what she's saying, with what she's doing for screen
// readers and tests (`data-pose`): wave (nothing to act on), think (working:
// a soft ring breathes around her, still with reduced motion) or point
// (presenting something to act on).
export function DeniseAvatar({ pose, className = "" }: { pose: Pose; className?: string }) {
  return (
    <span role="img" aria-label={POSE_LABELS[pose]} data-pose={pose} className={`relative inline-flex shrink-0 ${className}`}>
      {pose === "think" && <span aria-hidden className="absolute -inset-1 animate-pulse rounded-full ring-2 ring-denise-300" />}
      <DeniseFace size={24} />
    </span>
  );
}

const DRAWINGS = { wave, think, point };

// The full illustration, waving, for signing in, the welcome and empty
// states; thinking and pointing only on Meet Denise.
export function DenisePose({ pose = "wave", className = "w-24" }: { pose?: Pose; className?: string }) {
  return (
    <div role="img" aria-label={POSE_LABELS[pose]} data-pose={pose} className={`relative aspect-[1211/1299] shrink-0 ${className}`}>
      <Image src={DRAWINGS[pose]} alt="" sizes="160px" priority={pose === "wave"} className="absolute inset-0 size-full object-contain" />
    </div>
  );
}
