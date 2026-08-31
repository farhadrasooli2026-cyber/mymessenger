import type { CSSProperties } from "react";
import type { BackgroundSpec } from "@/lib/appearance-types";

export function backgroundCss(spec: BackgroundSpec): CSSProperties {
  if (spec.kind === "solid") {
    return { backgroundColor: spec.color };
  }
  if (spec.kind === "gradient") {
    return { backgroundImage: `linear-gradient(${spec.direction}, ${spec.from}, ${spec.to})` };
  }
  if (spec.kind === "catalog") {
    return {
      backgroundImage: `url(/api/media/bg-catalog/${spec.catalogId})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (spec.kind === "upload") {
    return {
      backgroundImage: `url(/api/media/background/${spec.assetId})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return {};
}

export function backgroundPreview(spec: BackgroundSpec, localDataUrl?: string): CSSProperties {
  if (spec.kind === "upload" && localDataUrl) {
    return { backgroundImage: `url(${localDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  if (spec.kind === "default") {
    return {
      backgroundColor: "#071614",
      backgroundImage:
        "radial-gradient(circle at 20% 10%, rgba(52,211,153,0.2), transparent 40%), radial-gradient(circle at 90% 0%, rgba(251,191,36,0.16), transparent 36%)",
    };
  }
  return backgroundCss(spec);
}
