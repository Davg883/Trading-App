import {runScheduledOperations} from '../../../../lib/remote-ops/server';

export async function POST(request:Request){
 return runScheduledOperations(request);
}
