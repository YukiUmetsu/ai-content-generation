# Duration and destination profiles — research reviewed 2026-10-22

**Status:** dated evidence for editorial duration targets. Recheck every platform limit before relying on it. Moved here unchanged from the headless video production design, which described work that has since shipped.


**Duration is editorial, not a fixed render constant.** Store `destinationProfileId`, aspect ratio, FPS, `targetDurationSeconds` (advisory range), `minimumDurationSeconds` (only when the user/destination requires it), and measured narration-derived `actualDurationSeconds`. Duration must follow the approved story and real generated voice timing; never silently pad, truncate, accelerate or loop material to meet a monetization threshold. Hard platform eligibility/caps are validated independently from adjustable creative targets. Profiles are versioned so platform changes do not rewrite historical jobs.

| Destination | Initial **editorial** target, not a universal optimum | Relevant platform constraint / evidence |
| --- | --- | --- |
| YouTube regular 16:9 | **9–15 minutes** as a starting range; **8 minutes minimum** for this product goal; longer where the explanation earns it | YouTube makes videos 8 minutes or longer eligible for mid-roll ads, without guaranteeing placement or revenue: https://support.google.com/youtube/answer/2467968 |
| YouTube Shorts 9:16 | **45–120 seconds** initially, up to 180 seconds where useful | YouTube accepts square/vertical Shorts up to 3 minutes. Official help updated September 2026 says newer Shorts over one minute with Content ID claims are **not automatically blocked** (older localized guidance conflicts); claims and music rights still need individual checks: https://support.google.com/youtube/answer/15424877?hl=en-ws |
| TikTok 9:16 | **90–180 seconds**, test 90 and 150 seconds initially | TikTok Creator Rewards requires original videos of at least one minute (not a reach guarantee): https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program ; 2026 observed view medians rose through 120–180 seconds in a large brand-account sample: https://www.socialinsider.io/blog/how-long-are-tiktok-videos/ |
| Instagram Reels 9:16 | **45–60 seconds** for discovery; **120–180 seconds** when substance benefits | Reels longer than 3 minutes are not recommended to new audiences: https://help.instagram.com/2720958398006062/ ; 2026 original brand-account analysis favored 45–60 seconds: https://www.socialinsider.io/blog/instagram-reels-length/ |
| Facebook Reels 9:16 | **120–180 seconds** as an initial test | Meta removed fixed format/length distinctions for Facebook video/Reels; 2026 brand-account sample found strong 2–3-minute engagement: https://www.socialinsider.io/social-media-benchmarks/social-media-video-statistics ; https://about.fb.com/news/2025/06/facebook-video-reels/ |

These are *hypotheses* for the user's educational/ad-funded channels, not guarantees. The social-media benchmarks are observational and may not predict a new creator's performance. Record retention, average view duration, qualified views and ad revenue per destination/length after publishing; optimize using actual channel data. Source-derived limits and rights must be rechecked before automatic uploads.

**Story architecture:** a long explainer needs sustained setup, mechanisms, worked examples, visual variety, source caveats, and a payoff/takeaway; do not simply repeat a 45-second story. A portrait short gets a separate hook, compressed but complete claim, redesigned 9:16 visual staging, and target profile. Sharing research assets, brand and source IDs is encouraged; speed-changing, blind cropping or automatically chopping the long video is not sufficient.

**Acceptance tiers:** (1) 30–60-second offline mock integration smoke; (2) 8+-minute 16:9 complete production using *real* automatically generated Fish or local TTS, full playback, QA and manifest; (3) later 9:16 destination tests independently authored to the platform-specific range. A smoke test cannot be reported as tier 2. The 8-minute floor is the user's chosen long-form product requirement, not a universal YouTube recommendation.

