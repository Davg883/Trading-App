import {updateOperationsSettings} from '../../../../lib/remote-ops/server';

export async function POST(request:Request){
 return updateOperationsSettings(request);
}
