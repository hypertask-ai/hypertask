# UTM Parameter Test URL

Use this URL to test all UTM parameters:

## Test URL with All Parameters

```
https://app.hypertask.ai/?utm_source=test_source&utm_medium=test_medium&utm_campaign=test_campaign&utm_group=test_group&utm_creative=test_creative&utm_fbclid=test_fbclid_123456789&utm_term=test_term&utm_content=test_content&utm_id=test_id_123
```

## Individual Parameter Test URLs

### Required Parameters (that are missing):
- `utm_source`: `https://app.hypertask.ai/?utm_source=google`
- `utm_medium`: `https://app.hypertask.ai/?utm_medium=cpc`
- `utm_campaign`: `https://app.hypertask.ai/?utm_campaign=summer_sale`
- `utm_creative`: `https://app.hypertask.ai/?utm_creative=banner_ad_1`

### Parameters that are present:
- `utm_group`: `https://app.hypertask.ai/?utm_group=ad_group_1`
- `utm_fbclid`: `https://app.hypertask.ai/?utm_fbclid=EAIaIQobChMI...`

## Complete Test URL (All Parameters)

```
https://app.hypertask.ai/?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale_2024&utm_group=ad_group_1&utm_creative=banner_ad_v1&utm_fbclid=EAIaIQobChMI123456789&utm_term=productivity&utm_content=landing_page&utm_id=campaign_123
```

## How to Test

1. Open browser DevTools (F12)
2. Go to Application/Storage tab → Cookies
3. Visit the test URL above
4. Check the `utm_data` cookie - it should contain all parameters as JSON
5. Check individual cookies (utm_source, utm_medium, etc.)
6. Check console logs for any warnings about missing parameters

## Expected Cookie Values

After visiting the test URL, you should see:

### `utm_data` cookie (JSON):
```json
{
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "summer_sale_2024",
  "utm_group": "ad_group_1",
  "utm_creative": "banner_ad_v1",
  "utm_fbclid": "EAIaIQobChMI123456789",
  "utm_term": "productivity",
  "utm_content": "landing_page",
  "utm_id": "campaign_123"
}
```

### Individual cookies:
- `utm_source=google`
- `utm_medium=cpc`
- `utm_campaign=summer_sale_2024`
- `utm_group=ad_group_1`
- `utm_creative=banner_ad_v1`
- `utm_fbclid=EAIaIQobChMI123456789`
- `utm_term=productivity`
- `utm_content=landing_page`
- `utm_id=campaign_123`

## Possible Issues

### 1. Cookie Size Limit
- Cookies have a 4KB size limit
- If the JSON string exceeds this, it may be truncated
- Check console for warnings about cookie size

### 2. URL Encoding
- Special characters in UTM values should be URL encoded
- Example: `utm_source=google%20ads` (space encoded as %20)

### 3. Missing Parameters
- Parameters only get stored if they're present in the URL
- If a parameter is missing from the URL, it won't be in the cookie
- Check console logs for verification

### 4. Cookie Domain/Path Issues
- Cookies are set with `path=/`
- Make sure you're checking cookies for the correct domain
- Clear cookies before testing to ensure clean state

## Debugging Steps

1. **Clear all cookies** before testing
2. Visit the test URL
3. Open DevTools → Console
4. Look for logs:
   - `🔍 UTM parameters found in URL:` - shows what was extracted
   - `✅ UTM parameters stored:` - shows what was stored
   - `📦 UTM data stored in cookies:` - shows what was read back
   - `⚠️ Some UTM parameters were not stored:` - indicates missing params
5. Check Application → Cookies → `utm_data` cookie value
6. Verify JSON is valid and contains all expected keys

