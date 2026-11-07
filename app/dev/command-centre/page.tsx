import {notFound} from "next/navigation";
import {researchFeed} from "../../../lib/portfolio/research-feed";
import FixturePreview from "./preview";
import "../../command-centre.css";
import "../../broker-sync.css";

/** Development-only layout preview with labelled synthetic fixtures. Returns 404 in production. */
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{fixture?:string}>}){
  if(process.env.NODE_ENV==="production")notFound();
  const {fixture}=await searchParams;
  return <main className="cc-preview-main"><FixturePreview fixture={fixture==="empty"||fixture==="stale"?fixture:"sample"} feed={researchFeed()}/></main>;
}
