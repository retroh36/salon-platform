import Image from "next/image";
import face from "@/public/brand/denise/face.png";
import point from "@/public/brand/denise/point.png";
import think from "@/public/brand/denise/think.png";
import wave from "@/public/brand/denise/wave.png";

// Denise, the AI assistant (short for DNIS, Digital Navigator of Issues and
// Scheduling). Her poses: wave when there's nothing to do, think while
// she's working, point when she's presenting a fix.
export type Pose = "wave" | "think" | "point";

const POSES = { wave, think, point };

const POSE_LABELS: Record<Pose, string> = {
  wave: "Denise waving",
  think: "Denise thinking",
  point: "Denise pointing at a suggestion",
};

// Her face, for the tab badge and small spots.
export function DeniseFace({ size = 28, className = "" }: { size?: number; className?: string }) {
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

// The full mascot. Changing pose crossfades with a gentle lift; with reduced
// motion it switches instantly.
export function DenisePose({ pose, className = "w-24" }: { pose: Pose; className?: string }) {
  return (
    <div role="img" aria-label={POSE_LABELS[pose]} data-pose={pose} className={`relative aspect-[1211/1299] shrink-0 ${className}`}>
      {(Object.keys(POSES) as Pose[]).map((p) => (
        <Image
          key={p}
          src={POSES[p]}
          alt=""
          sizes="128px"
          priority={p === "wave"}
          className={`absolute inset-0 size-full object-contain transition-[opacity,transform] duration-(--motion-slow) ease-out ${
            p === pose ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-95 opacity-0"
          }`}
        />
      ))}
    </div>
  );
}
