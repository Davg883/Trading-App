import type { Metadata } from 'next';
import StressMonitor from '../../components/stress-monitor';
import './stress.css';
export const metadata:Metadata={title:'Market Stress & Valuation | AI Capital Intelligence',description:'Source-aware market stress, valuation resets and registered research outcomes.'};
export default function StressPage(){return <StressMonitor/>;}
