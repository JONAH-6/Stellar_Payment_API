import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './PortfolioChart.css';

// Note: This is a simplified chart component
// In a real implementation, you might use Recharts, Chart.js, or D3
// For testing purposes, we'll create a basic SVG-based chart

const PortfolioChart = ({
  data = [],
  title = 'Portfolio Performance',
  loading = false,
  error = null,
  currency = 'USD',
  interactive = true,
  showLegend = true,
  onDataPointClick = null,
  onRangeChange = null,
  ariaLabel = 'Portfolio performance chart',
  height = 400,
  width = '100%',
  responsive = true,
  keyboardNavigation = true,
  announcementRegion = true,
  dateRangePicker = false
}) => {
  const [activePoint, setActivePoint] = useState(null);
  const [selectedRange, setSelectedRange] = useState('1Y');
  const [isMobile, setIsMobile] = useState(false);

  // Check for mobile viewport
  useEffect(() => {
    if (!responsive) return;
    
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [responsive]);

  // Format currency values
  const formatCurrency = useCallback((value) => {
    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    }
    return `$${value.toLocaleString()}`;
  }, [currency]);

  // Find min and max values for scaling
  const { minValue, maxValue } = useMemo(() => {
    if (!data || data.length === 0) return { minValue: 0, maxValue: 100 };
    const values = data.map(d => d.value);
    return {
      minValue: Math.min(...values, 0),
      maxValue: Math.max(...values, 100)
    };
  }, [data]);

  // Calculate chart points for SVG rendering
  const chartPoints = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const width = isMobile ? 300 : 600;
    const height_val = isMobile ? 200 : 300;
    const padding = 40;
    const chartWidth = width - 2 * padding;
    const chartHeight = height_val - 2 * padding;
    
    return data.map((point, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - 
        ((point.value - minValue) / (maxValue - minValue)) * chartHeight;
      return { x, y, value: point.value, date: point.date, original: point };
    });
  }, [data, minValue, maxValue, isMobile]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!keyboardNavigation || !interactive) return;
    
    if (e.key === 'ArrowRight' && activePoint !== null && activePoint < chartPoints.length - 1) {
      setActivePoint(activePoint + 1);
      if (announcementRegion) {
        const announcement = `Data point ${activePoint + 2}: ${formatCurrency(chartPoints[activePoint + 1].value)}`;
        const liveRegion = document.getElementById('sr-announcements');
        if (liveRegion) liveRegion.textContent = announcement;
      }
    } else if (e.key === 'ArrowLeft' && activePoint !== null && activePoint > 0) {
      setActivePoint(activePoint - 1);
      if (announcementRegion) {
        const announcement = `Data point ${activePoint}: ${formatCurrency(chartPoints[activePoint - 1].value)}`;
        const liveRegion = document.getElementById('sr-announcements');
        if (liveRegion) liveRegion.textContent = announcement;
      }
    } else if (e.key === 'ArrowRight' && activePoint === null && chartPoints.length > 0) {
      setActivePoint(0);
    }
  }, [keyboardNavigation, interactive, activePoint, chartPoints, formatCurrency, announcementRegion]);

  // Handle range selection
  const handleRangeChange = useCallback((range) => {
    setSelectedRange(range);
    if (onRangeChange) {
      onRangeChange(range);
    }
  }, [onRangeChange]);

  // Loading state
  if (loading) {
    return (
      <div className="portfolio-chart loading" role="status" aria-label="Loading chart">
        <div className="loading-spinner"></div>
        <p>Loading chart data...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="portfolio-chart error" role="alert">
        <p>Error: {error}</p>
      </div>
    );
  }

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className="portfolio-chart empty">
        <p>No portfolio data available</p>
      </div>
    );
  }

  return (
    <div 
      className={`portfolio-chart ${isMobile ? 'mobile-view' : 'desktop-view'}`}
      data-testid="portfolio-chart"
      role="figure"
      aria-label={ariaLabel}
    >
      {title && <h3 className="chart-title">{title}</h3>}
      
      {/* Date Range Picker */}
      {dateRangePicker && (
        <div className="range-picker">
          <button 
            onClick={() => handleRangeChange('1M')}
            className={selectedRange === '1M' ? 'active' : ''}
          >
            1M
          </button>
          <button 
            onClick={() => handleRangeChange('3M')}
            className={selectedRange === '3M' ? 'active' : ''}
          >
            3M
          </button>
          <button 
            onClick={() => handleRangeChange('6M')}
            className={selectedRange === '6M' ? 'active' : ''}
          >
            6M
          </button>
          <button 
            onClick={() => handleRangeChange('1Y')}
            className={selectedRange === '1Y' ? 'active' : ''}
          >
            1Y
          </button>
        </div>
      )}
      
      {/* Chart Container */}
      <div 
        className="chart-container"
        data-testid="chart-container"
        style={{ height: isMobile ? '300px' : `${height}px` }}
      >
        <svg 
          width={width} 
          height={isMobile ? 300 : height}
          viewBox={`0 0 ${isMobile ? 400 : 800} ${isMobile ? 300 : height}`}
          onKeyDown={handleKeyDown}
          tabIndex={keyboardNavigation ? 0 : -1}
          role="img"
          aria-label={ariaLabel}
        >
          {/* Grid lines */}
          <g className="grid-lines">
            {[0, 25, 50, 75, 100].map((percent, i) => (
              <line
                key={i}
                x1="40"
                y1={40 + (percent / 100) * (isMobile ? 220 : 260)}
                x2={isMobile ? 360 : 760}
                y2={40 + (percent / 100) * (isMobile ? 220 : 260)}
                stroke="#e0e0e0"
                strokeDasharray="5,5"
              />
            ))}
          </g>
          
          {/* Chart line */}
          <polyline
            data-testid="chart-line"
            points={chartPoints.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#4CAF50"
            strokeWidth="3"
          />
          
          {/* Data points */}
          {chartPoints.map((point, index) => (
            <circle
              key={index}
              data-testid={`data-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={activePoint === index ? 8 : 5}
              fill={activePoint === index ? '#ff5722' : '#4CAF50'}
              onMouseEnter={() => interactive && setActivePoint(index)}
              onMouseLeave={() => interactive && setActivePoint(null)}
              onClick={() => onDataPointClick && onDataPointClick(point.original)}
            />
          ))}
          
          {/* Labels */}
          <g className="labels">
            {chartPoints.map((point, index) => (
              <text
                key={index}
                x={point.x}
                y={isMobile ? 280 : 360}
                textAnchor="middle"
                fontSize="12"
              >
                {point.date}
              </text>
            ))}
          </g>
        </svg>
      </div>
      
      {/* Legend */}
      {showLegend && (
        <div className="chart-legend" data-testid="chart-legend">
          <div className="legend-item">
            <span className="legend-color"></span>
            <span>Portfolio Value</span>
          </div>
        </div>
      )}
      
      {/* Screen reader announcements */}
      {announcementRegion && (
        <div 
          id="sr-announcements"
          data-testid="sr-announcements"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        ></div>
      )}
      
      {/* Tooltip for active point */}
      {activePoint !== null && chartPoints[activePoint] && interactive && (
        <div 
          className="chart-tooltip"
          data-testid="chart-tooltip"
          style={{
            position: 'absolute',
            left: `${chartPoints[activePoint].x}px`,
            top: `${chartPoints[activePoint].y - 30}px`
          }}
        >
          <strong>{chartPoints[activePoint].date}</strong>
          <br />
          {formatCurrency(chartPoints[activePoint].value)}
        </div>
      )}
    </div>
  );
};

export default PortfolioChart;