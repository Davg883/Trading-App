import {listBrokerConnections,saveBrokerConnection,deleteBrokerConnection} from '../../../lib/brokers/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=listBrokerConnections;
export const POST=saveBrokerConnection;
export const DELETE=deleteBrokerConnection;

export const maxDuration=60;
