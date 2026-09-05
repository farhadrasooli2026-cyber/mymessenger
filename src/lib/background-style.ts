import type { CSSProperties } from "react";
import type { BackgroundSpec } from "@/lib/appearance-types";

export type BgFx = { opacity?: number; blur?: number };

function withFx(base: CSSProperties, fx?: BgFx): CSSProperties {
  if (!fx) return base;
  const opacity = fx.opacity == null ? undefined : Math.max(0.2, Math.min(1, fx.opacity / 100));
  const blur = fx.blur ? `blur(${fx.blur}px)` : undefined;
  return {
    ...base,
    ...(opacity != null ? { opacity } : {}),
    ...(blur ? { filter: blur } : {}),
  };
}

export function backgroundCss(spec: BackgroundSpec, fx?: BgFx): CSSProperties {
  if (spec.kind === "solid") {
    return withFx({ backgroundColor: spec.color }, fx);
  }
  if (spec.kind === "gradient") {
    return withFx({ backgroundImage: `linear-gradient(${spec.direction}, ${spec.from}, ${spec.to})` }, fx);
  }
  if (spec.kind === "public") {
    return withFx(
      {
        backgroundImage: `url(${spec.path})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
      fx,
    );
  }
  if (spec.kind === "catalog") {
    return withFx(
      {
        backgroundImage: `url(/api/media/bg-catalog/${spec.catalogId})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
      fx,
    );
  }
  if (spec.kind === "upload") {
    return withFx(
      {
        backgroundImage: `url(/api/media/background/${spec.assetId})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
      fx,
    );
  }
  return withFx({}, fx);
}

export function backgroundPreview(spec: BackgroundSpec, localDataUrl?: string, fx?: BgFx): CSSProperties {
  if (spec.kind === "upload" && localDataUrl) {
    return withFx({ backgroundImage: `url(${localDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" }, fx);
  }
  if (spec.kind === "default") {
    return withFx(
      {
        backgroundColor: "#071614",
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(52,211,153,0.2), transparent 40%), radial-gradient(circle at 90% 0%, rgba(251,191,36,0.16), transparent 36%)",
      },
      fx,
    );
  }
  return backgroundCss(spec, fx);
}
