import type { Metadata } from 'next';
import EarningsCase, { type EarningsCaseData } from '../../components/earnings-case';
import alphabet from '../../data/earnings/alphabet-q3-2026.json';
import './earnings.css';

export const metadata: Metadata = { title: 'Alphabet earnings case | AI Capital Intelligence', description: 'Source-backed earnings economics, evidence timing and controlled benchmark preparation.' };

export default function EarningsPage() {
  return <EarningsCase data={alphabet as EarningsCaseData}/>;
}
