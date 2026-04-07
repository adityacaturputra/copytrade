'use client';

import { BinancePriceData } from '../hooks/useBinanceWebSocket';
import { FundingDataState } from '../hooks/useFundingData';
import PriceBanner from './PriceBanner';
import WhaleActivity from './WhaleActivity';
import FundingDominance from './FundingDominance';
import DominanceOverview from './DominanceOverview';
import DominanceTimeline from './DominanceTimeline';
import FundingChart from './FundingChart';
import TradingViewWidget from './TradingViewWidget';

interface AdvancedTabProps {
  priceData: BinancePriceData;
  fundingData: FundingDataState;
}

export default function AdvancedTab({ priceData, fundingData }: AdvancedTabProps) {
  return (
    <>
      <PriceBanner priceData={priceData} />
      <WhaleActivity />
      <FundingDominance fundingHistory={fundingData.fundingHistory} />
      <DominanceOverview fundingHistory={fundingData.fundingHistory} />
      <DominanceTimeline fundingHistory={fundingData.fundingHistory} />
      <FundingChart fundingHistory={fundingData.fundingHistory} />
      <TradingViewWidget />
    </>
  );
}
