"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

interface Coin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency: number;
  high_24h: number;
  low_24h: number;
  sparkline_in_7d: { price: number[] };
}

type SortKey =
  | "market_cap_rank"
  | "current_price"
  | "price_change_percentage_24h"
  | "price_change_percentage_7d_in_currency"
  | "total_volume";
type Currency = "usd" | "eur" | "gbp";

interface ApiError {
  label: string;
  code: string;
  detail: string;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
};

function formatNumber(n: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: n < 1 ? 6 : 2,
  }).format(n);
}

function formatCompact(n: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (n >= 1e12) return `${symbol}${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${symbol}${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${symbol}${(n / 1e6).toFixed(2)}M`;
  return formatNumber(n, currency);
}

async function fetchCoins(currency: Currency): Promise<Coin[]> {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=10&page=1&sparkline=true&price_change_percentage=7d`
  );

  if (!res.ok) {
    let serverMessage = "";
    try {
      const body = await res.text();
      const json = JSON.parse(body);
      serverMessage =
        json.error || json.message || json.status?.error_message || body.slice(0, 200);
    } catch {
      // body wasn't JSON
    }

    const error: ApiError =
      res.status === 429
        ? {
            label: "Rate Limit",
            code: `HTTP ${res.status} — Too Many Requests`,
            detail:
              serverMessage ||
              "CoinGecko free tier allows ~30 req/min. Wait a moment before retrying.",
          }
        : res.status === 403
          ? {
              label: "Access Denied",
              code: `HTTP ${res.status} — Forbidden`,
              detail:
                serverMessage ||
                "Request blocked by CoinGecko. Check IP restrictions or CORS.",
            }
          : res.status >= 500
            ? {
                label: "Server Error",
                code: `HTTP ${res.status} — ${res.statusText}`,
                detail:
                  serverMessage ||
                  "CoinGecko is experiencing issues. Check status.coingecko.com.",
              }
            : res.status >= 400
              ? {
                  label: "Client Error",
                  code: `HTTP ${res.status} — ${res.statusText}`,
                  detail:
                    serverMessage ||
                    "Bad request or invalid parameters sent to CoinGecko API.",
                }
              : {
                  label: "Request Failed",
                  code: `HTTP ${res.status} — ${res.statusText}`,
                  detail:
                    serverMessage || "Unexpected response from CoinGecko API.",
                };

    throw error;
  }

  return res.json();
}

function SparklineChart({ prices }: { prices: number[] }) {
  if (!prices || prices.length === 0) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const width = 120;
  const height = 32;

  const points = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - ((p - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const isUp = prices[prices.length - 1] >= prices[0];

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PriceBar({
  low,
  high,
  current,
}: {
  low: number;
  high: number;
  current: number;
}) {
  const range = high - low || 1;
  const position = ((current - low) / range) * 100;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>L</span>
        <span>H</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="absolute h-1.5 rounded-full bg-gradient-to-r from-red-400 via-yellow-400 to-green-400"
          style={{ width: "100%" }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-gray-800 dark:border-white"
          style={{
            left: `${Math.min(Math.max(position, 0), 100)}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>
    </div>
  );
}

export default function CryptoDashboard() {
  const [toasts, setToasts] = useState<
    { id: number; label: string; code: string; detail: string; type: "error" | "info" }[]
  >([]);
  const toastId = useRef(0);
  const [currency, setCurrency] = useState<Currency>("usd");
  const [sortKey, setSortKey] = useState<SortKey>("market_cap_rank");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addToast = useCallback(
    (toast: { label: string; code: string; detail: string; type?: "error" | "info" }) => {
      const id = ++toastId.current;
      setToasts((prev) => [...prev, { id, type: "error", ...toast }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8000);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const {
    data: coins = [],
    isLoading,
    isFetching,
    dataUpdatedAt,
    error,
    refetch,
  } = useQuery({
    queryKey: ["coins", currency],
    queryFn: () => fetchCoins(currency),
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
  });

  // Show toast when query errors
  const lastErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (!error || error === lastErrorRef.current) return;
    lastErrorRef.current = error;

    if (error && typeof error === "object" && "label" in error) {
      addToast(error as unknown as ApiError);
    } else if (error instanceof TypeError && error.message === "Failed to fetch") {
      addToast({
        label: "Network Error",
        code: "ERR_NETWORK",
        detail:
          "Could not reach CoinGecko. Check your internet connection or ad blockers.",
      });
    } else {
      addToast({
        label: "Fetch Error",
        code: error instanceof Error ? error.name : "UNKNOWN",
        detail:
          error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  }, [error, addToast]);

  // Countdown timer for visual feedback
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!autoRefresh) {
      setCountdown(0);
      return;
    }

    setCountdown(refreshInterval);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? refreshInterval : prev - 1));
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, refreshInterval, dataUpdatedAt]);

  // Reset countdown when data is fetched
  useEffect(() => {
    if (autoRefresh && dataUpdatedAt) {
      setCountdown(refreshInterval);
    }
  }, [dataUpdatedAt, autoRefresh, refreshInterval]);

  const loading = isLoading || isFetching;

  const sorted = [...coins].sort((a, b) => {
    const aVal = a[sortKey] ?? 0;
    const bVal = b[sortKey] ?? 0;
    return sortAsc ? (aVal > bVal ? 1 : -1) : aVal < bVal ? 1 : -1;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "market_cap_rank");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column)
      return <span className="text-gray-400 ml-1">↕</span>;
    return <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>;
  }

  const selectedData = coins.find((c) => c.id === selectedCoin);
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Top 10 Cryptocurrencies
          </h2>
          {lastUpdated && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Currency picker */}
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            {(["usd", "eur", "gbp"] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  currency === c
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {CURRENCY_SYMBOLS[c]} {c.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

          {/* Auto-refresh toggle */}
          <button
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              autoRefresh ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                autoRefresh ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>

          {/* Frequency picker */}
          <div
            className={`flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 transition-opacity ${autoRefresh ? "" : "opacity-40 pointer-events-none"}`}
          >
            {(
              [
                { value: 30, label: "30s" },
                { value: 60, label: "1m" },
                { value: 300, label: "5m" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRefreshInterval(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  refreshInterval === opt.value
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Countdown */}
          {autoRefresh && countdown > 0 && (
            <div className="flex items-center gap-1.5">
              <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20">
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-gray-200 dark:text-gray-700"
                />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={2 * Math.PI * 8}
                  strokeDashoffset={
                    2 * Math.PI * 8 * (1 - countdown / refreshInterval)
                  }
                  strokeLinecap="round"
                  className="text-indigo-600 transition-all duration-1000 ease-linear"
                />
              </svg>
              <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
                {countdown}s
              </span>
            </div>
          )}

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

          {/* Refresh button */}
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-left">
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:text-gray-900 dark:hover:text-white whitespace-nowrap"
                  onClick={() => handleSort("market_cap_rank")}
                >
                  # Rank <SortIcon column="market_cap_rank" />
                </th>
                <th className="px-4 py-3 font-medium">Coin</th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:text-gray-900 dark:hover:text-white text-right whitespace-nowrap"
                  onClick={() => handleSort("current_price")}
                >
                  Price <SortIcon column="current_price" />
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:text-gray-900 dark:hover:text-white text-right whitespace-nowrap"
                  onClick={() => handleSort("price_change_percentage_24h")}
                >
                  24h % <SortIcon column="price_change_percentage_24h" />
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:text-gray-900 dark:hover:text-white text-right whitespace-nowrap"
                  onClick={() =>
                    handleSort("price_change_percentage_7d_in_currency")
                  }
                >
                  7d %{" "}
                  <SortIcon column="price_change_percentage_7d_in_currency" />
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:text-gray-900 dark:hover:text-white text-right whitespace-nowrap"
                  onClick={() => handleSort("total_volume")}
                >
                  Volume <SortIcon column="total_volume" />
                </th>
                <th className="px-4 py-3 font-medium text-center whitespace-nowrap">
                  24h Range
                </th>
                <th className="px-4 py-3 font-medium text-center whitespace-nowrap">
                  7d Chart
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && coins.length === 0
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr
                      key={i}
                      className="border-t border-gray-100 dark:border-gray-800 animate-pulse"
                    >
                      <td className="px-4 py-4" colSpan={8}>
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                      </td>
                    </tr>
                  ))
                : sorted.map((coin) => (
                    <tr
                      key={coin.id}
                      onClick={() =>
                        setSelectedCoin(
                          selectedCoin === coin.id ? null : coin.id
                        )
                      }
                      className={`border-t border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
                        selectedCoin === coin.id
                          ? "bg-indigo-50 dark:bg-indigo-900/20"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono">
                        {coin.market_cap_rank}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <img
                            src={coin.image}
                            alt={coin.name}
                            width={24}
                            height={24}
                            className="rounded-full"
                          />
                          <span className="font-medium text-gray-900 dark:text-white">
                            {coin.name}
                          </span>
                          <span className="text-gray-400 uppercase text-xs">
                            {coin.symbol}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-900 dark:text-white">
                        {formatNumber(coin.current_price, currency)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          coin.price_change_percentage_24h >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {coin.price_change_percentage_24h >= 0 ? "+" : ""}
                        {coin.price_change_percentage_24h?.toFixed(2) ?? "—"}%
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          (coin.price_change_percentage_7d_in_currency ?? 0) >=
                          0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {(coin.price_change_percentage_7d_in_currency ?? 0) >= 0
                          ? "+"
                          : ""}
                        {coin.price_change_percentage_7d_in_currency?.toFixed(
                          2
                        ) ?? "—"}
                        %
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                        {formatCompact(coin.total_volume, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-28 mx-auto">
                          <PriceBar
                            low={coin.low_24h}
                            high={coin.high_24h}
                            current={coin.current_price}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <SparklineChart
                          prices={coin.sparkline_in_7d?.price ?? []}
                        />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selectedData && (
        <div className="mt-4 p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm animate-in">
          <div className="flex items-center gap-3 mb-4">
            <img
              src={selectedData.image}
              alt={selectedData.name}
              width={40}
              height={40}
              className="rounded-full"
            />
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {selectedData.name}
                <span className="ml-2 text-sm font-normal text-gray-400 uppercase">
                  {selectedData.symbol}
                </span>
              </h3>
              <p className="text-sm text-gray-500">
                Rank #{selectedData.market_cap_rank}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Price"
              value={formatNumber(selectedData.current_price, currency)}
            />
            <StatCard
              label="Market Cap"
              value={formatCompact(selectedData.market_cap, currency)}
            />
            <StatCard
              label="24h Volume"
              value={formatCompact(selectedData.total_volume, currency)}
            />
            <StatCard
              label="24h High / Low"
              value={`${formatNumber(selectedData.high_24h, currency)} / ${formatNumber(selectedData.low_24h, currency)}`}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 text-center">
        Data from CoinGecko free API. Prices may be delayed.
      </p>

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 w-96">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-lg shadow-lg border animate-slide-in overflow-hidden ${
              toast.type === "error"
                ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
                : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
            }`}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span
                className={`text-xs font-bold uppercase tracking-wide ${
                  toast.type === "error"
                    ? "text-red-600 dark:text-red-400"
                    : "text-blue-600 dark:text-blue-400"
                }`}
              >
                {toast.label}
              </span>
              <button
                onClick={() => dismissToast(toast.id)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-4 pb-3">
              <p
                className={`text-xs font-mono mb-1 ${
                  toast.type === "error"
                    ? "text-red-500 dark:text-red-300"
                    : "text-blue-500 dark:text-blue-300"
                }`}
              >
                {toast.code}
              </p>
              <p
                className={`text-sm ${
                  toast.type === "error"
                    ? "text-red-800 dark:text-red-200"
                    : "text-blue-800 dark:text-blue-200"
                }`}
              >
                {toast.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
