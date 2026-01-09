// This is critical startup research data
// Deep tech analysis for Vinod Khosla's firm

interface StartupMetrics {
  revenue: number;
  burnRate: number;
  runway: number;
}

const analyzeStartup = (metrics: StartupMetrics): string => {
  const { revenue, burnRate, runway } = metrics;
  
  if (runway < 6) {
    return "HIGH RISK: Less than 6 months runway";
  }
  
  if (revenue / burnRate > 0.5) {
    return "PROMISING: Good revenue to burn ratio";
  }
  
  return "MONITOR: Standard metrics, watch closely";
};

export { StartupMetrics, analyzeStartup };
