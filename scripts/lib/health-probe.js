#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * v0.6.0 起 body 带 ready 字段；更早的部署只有 status。
 * 旧部署没有显式 ready:false 时继续视为健康，避免版本切换期误报。
 */
function isHealthyResponse(status, body) {
  return status === 200 && body?.status === "ok" && body?.ready !== false;
}

function isRetryableResult(result) {
  return result.status === 0 || result.status === 200 || RETRYABLE_STATUS.has(result.status);
}

async function requestHealthOnce(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const responseInit = options.responseInit ?? {};
  try {
    const response = await options.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      ...responseInit,
      headers: { Accept: "application/json", ...(responseInit.headers ?? {}) },
      cache: responseInit.cache ?? "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return {
      healthy: isHealthyResponse(response.status, body),
      status: response.status,
      body,
      headers: response.headers,
      error: null,
    };
  } catch (error) {
    return {
      healthy: false,
      status: 0,
      body: null,
      headers: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 有限重试健康探测。只重试网络错误、5xx 和“HTTP 200 但 body 未就绪”；
 * 401/404 等确定的配置错误立即返回，避免掩盖真实故障。
 */
async function probeHealth(url, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    sleepImpl = sleep,
    responseInit,
    validate,
    onRetry,
  } = options;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }

  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await requestHealthOnce(url, { fetchImpl, timeoutMs, responseInit });
    if (validate) lastResult.healthy = Boolean(validate(lastResult));
    if (lastResult.healthy || !isRetryableResult(lastResult) || attempt === attempts) {
      return { ...lastResult, attempts: attempt };
    }

    const nextAttempt = attempt + 1;
    onRetry?.({ attempt, nextAttempt, attempts, result: lastResult });
    await sleepImpl(retryDelayMs);
  }

  return { ...lastResult, attempts };
}

module.exports = {
  DEFAULT_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  RETRYABLE_STATUS,
  isHealthyResponse,
  isRetryableResult,
  probeHealth,
  requestHealthOnce,
};
