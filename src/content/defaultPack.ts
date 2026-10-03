import raw from "../../content/default/pack.json";
import { loadContentPack, type ContentPack } from "./schema";

/** The built-in placeholder content pack, validated on first use. */
let cached: ContentPack | undefined;
export function defaultPack(): ContentPack {
  return (cached ??= loadContentPack(raw));
}
