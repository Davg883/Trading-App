import {getResearchStagingCursor,submitResearchStaging} from '../../../../lib/remote-ops/server';

export async function GET(request:Request){
 return getResearchStagingCursor(request);
}

export async function POST(request:Request){
 return submitResearchStaging(request);
}
