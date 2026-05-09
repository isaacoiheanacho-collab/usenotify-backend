export function cleanUrl(originalUrl: string): string {
  try {
    const url = new URL(originalUrl);
    // Remove common tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'ref', 'source', 'si', 'feature', 'share'];
    trackingParams.forEach(param => url.searchParams.delete(param));
    return url.toString();
  } catch (error) {
    // If invalid URL, return original (will be validated later)
    return originalUrl;
  }
}