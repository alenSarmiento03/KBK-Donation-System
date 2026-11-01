# SEO deployment checklist

The site source is prepared for the new deployment, but the current Vercel deployment is an older version. Do not use that deployment URL in SEO records until the updated site is deployed and confirmed.

## After deploying the updated site

1. Confirm the production URL and that it serves the updated `index.html`, `robots.txt`, and `llms.txt`.
2. Create `sitemap.xml` using the confirmed HTTPS origin. Include only public, canonical URLs; exclude administrator pages, login, and query-string variants. Use absolute URLs in the sitemap.
3. Add a `Sitemap: https://YOUR-CONFIRMED-DOMAIN/sitemap.xml` line to `robots.txt`, replacing the example with the real origin.
4. The public HTML pages currently use relative canonical references. Check that each resolves to the intended production URL, especially the home page (`./`); absolute canonical URLs are preferred once the production origin is confirmed.
5. Add an absolute `og:image` URL pointing to the optimized KBK emblem or an approved social-sharing image. Confirm it is publicly fetchable without authentication; do not use a local `file:` URL.
6. Confirm Vercel serves HTTPS and redirects HTTP to HTTPS. Configure the production domain and redirect in Vercel; do not rely on an HTML meta tag for transport security.
7. In Google Search Console, choose **URL prefix** for the exact HTTPS production URL, or **Domain** if verifying every protocol and subdomain. Complete the offered DNS TXT or HTML-file verification and publish the verification record/file at the site root.
8. In Search Console, submit the sitemap URL, inspect the home page and representative public pages, and review indexing and HTTPS reports after Google has recrawled the site.

## Current implementation notes

- Administrator and login pages use `noindex, nofollow`; this is not access control. Keep the existing authentication and authorization protections in place.
- `robots.txt` intentionally does not block crawling, so search engines can see `noindex` directives on private application pages.
- The sitemap, absolute canonical URLs, absolute Open Graph image, and host-level HTTPS redirect depend on the confirmed production origin and are not guessed here.
- Existing `.html` paths are preserved to avoid breaking links. Add host-level redirects before changing them to cleaner URL slugs.
