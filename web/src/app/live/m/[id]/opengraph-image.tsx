// Remote data modes only: the share card of the on-demand member page (see app/live/m/[id]/page.tsx for why a twin exists).
// Without remote data nothing links here and every path is a 404.
import { IS_REMOTE } from "@/lib/data/server";
import { isMemberId } from "@/lib/data/ids";
import OpengraphImage, { alt as memberAlt } from "../../../m/[id]/opengraph-image";

export const alt = memberAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export default async function LiveOpengraphImage(props: { params: Promise<{ id: string }> }) {
  if (!IS_REMOTE || !isMemberId((await props.params).id)) return new Response("Not found", { status: 404 });
  return OpengraphImage(props);
}
