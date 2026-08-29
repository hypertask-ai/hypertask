# UTM Parameter Missing - Debugging Guide

## Possible Circumstances Where Parameters Can Be Missing

### 1. **Cookie Size Limit (4KB)**
**Most Likely Cause**
- Cookies have a hard 4KB (4096 bytes) size limit
- If the JSON stringified `utm_data` cookie exceeds this, the browser will truncate it
- **Solution**: The code now logs a warning if cookie size exceeds 4KB

**How to Check:**
```javascript
// In browser console:
document.cookie.split(';').find(c => c.includes('utm_data'))
// Check the length - if it's close to 4096 characters, it's truncated
```

### 2. **URL Parameters Not Present**
- If UTM parameters are missing from the URL, they won't be stored
- Parameters only get captured when they're in the URL query string
- **Solution**: Ensure all UTM parameters are included in the initial landing URL

### 3. **Cookie Domain/Path Mismatch**
- Cookies are set with `path=/` and `SameSite=Lax`
- If cookies are set on a different subdomain or path, they won't be accessible
- **Solution**: Ensure cookies are set on the same domain where they're read

### 4. **JSON Parsing Errors**
- If the `utm_data` cookie contains invalid JSON, parsing will fail
- The code falls back to individual cookies, but if those are also missing, data is lost
- **Solution**: Check console for parsing errors

### 5. **Browser Cookie Restrictions**
- Some browsers/extensions block cookies
- Private/Incognito mode may have restrictions
- Third-party cookie blocking
- **Solution**: Test in a clean browser session

### 6. **Cookie Expiration**
- Cookies expire after 30 days
- If cookies expired, they won't be available
- **Solution**: Check cookie expiration date in DevTools

### 7. **Race Condition**
- If the component runs before cookies are set, data might not be available
- **Solution**: The code now includes verification logging

### 8. **URL Encoding Issues**
- Special characters in UTM values might cause issues
- Values should be properly URL encoded
- **Solution**: Ensure proper encoding when constructing URLs

## Test URL with All Parameters

Use this URL to test all UTM parameters:

```
https://app.hypertask.ai/?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale_2024&utm_group=ad_group_1&utm_creative=banner_ad_v1&utm_fbclid=EAIaIQobChMI123456789&utm_term=productivity&utm_content=landing_page&utm_id=campaign_123
```

## Verification Steps

1. **Clear all cookies** before testing
2. Visit the test URL above
3. Open DevTools → Console
4. Look for these logs:
   - `🔍 UTM parameters found in URL:` - Shows extracted params
   - `✅ UTM parameters stored:` - Shows stored data with size info
   - `📦 UTM data stored in cookies:` - Shows verification read-back
   - `⚠️ Some UTM parameters were not stored:` - Indicates issues

5. **Check Application → Cookies:**
   - `utm_data` cookie should contain all parameters as JSON
   - Individual cookies (`utm_source`, `utm_medium`, etc.) should exist
   - Check cookie size - should be under 4KB

6. **Server-side logs** (if calling API):
   - `📊 UTM data from cookie:` - Shows what server received
   - `⚠️ Missing UTM parameters in cookie:` - Shows missing params

## Expected Behavior

After visiting the test URL, you should see:

### Client-side (Browser Console):
```
🔍 UTM parameters found in URL: {utm_source: "google", utm_medium: "cpc", ...}
✅ UTM parameters stored: {newParams: {...}, mergedData: {...}, cookieSize: "XXX bytes", allKeys: [...]}
📦 UTM data stored in cookies: {utm_source: "google", utm_medium: "cpc", ...}
```

### Server-side (API Logs):
```
📊 UTM data from cookie: {cookieSize: XXX, keys: [...], data: {...}}
```

## If Parameters Are Still Missing

1. **Check cookie size** - If close to 4KB, consider:
   - Shortening UTM parameter values
   - Storing only essential parameters
   - Using individual cookies instead of JSON cookie

2. **Check browser console** for errors or warnings

3. **Verify URL encoding** - Ensure special characters are properly encoded

4. **Test in different browsers** - Some browsers handle cookies differently

5. **Check network tab** - Verify cookies are being sent with API requests

6. **Server-side fallback** - The code falls back to individual cookies if JSON parsing fails

## Code Improvements Made

1. ✅ Added cookie size checking and warnings
2. ✅ Store ALL merged parameters as individual cookies (not just new ones)
3. ✅ Added verification logging to detect missing parameters
4. ✅ Improved server-side logging to show what's received
5. ✅ Better error handling for JSON parsing failures

