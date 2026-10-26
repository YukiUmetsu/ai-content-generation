//! Versioned, evidence-only viral opportunity heuristic for saved Discovery ideas.
//! A relative score is NOT a probability of going viral, a view forecast, or
//! absolute search demand. Never substitute the legacy editorial-readiness score.

use serde::Serialize;

use super::idea_market::IdeaMarketAssessment;
use super::idea_trends::GoogleTrendsAssessment;

const VERSION: &str = "viral-potential-v2";
const YOUTUBE_WEIGHT: f64 = 0.75;
const TRENDS_WEIGHT: f64 = 0.25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralPotential {
    pub score: Option<u8>,
    pub state: &'static str,
    pub score_version: &'static str,
    pub confidence: &'static str,
    pub comparison_basis: Option<&'static str>,
    pub format: Option<String>,
    pub youtube_score: Option<f64>,
    pub trend_score: Option<f64>,
    pub trend_change_percent: Option<f64>,
    pub coverage_percent: u8,
    pub sample_size: usize,
    pub distinct_channels: usize,
    pub comparison_cohort_size: usize,
    pub channel_breakout_score: Option<f64>,
    pub channel_baseline_videos: usize,
    pub channel_baseline_channels: usize,
    pub youtube_observed_at: Option<i64>,
    pub trends_observed_at: Option<i64>,
}

/// YouTube: a within-session, same-format percentile of observed lifetime
/// views/day, subject to sample/cohort quality gates. Trends: within-query
/// change between consecutive 13-week windows; -100% => 0, flat => 50,
/// +100% => 100 (capped). Google Trends indices cannot compare absolute
/// search volume across topics.
///
/// The numeric score REQUIRES a qualified YouTube cohort. If Trends is
/// unavailable, the YouTube percentile is displayed unchanged with a visible
/// partial-coverage label; missing Trends is never imputed as flat demand.
pub fn assess(
    market: Option<&IdeaMarketAssessment>,
    trends: Option<&GoogleTrendsAssessment>,
) -> ViralPotential {
    let session_comparison = market.and_then(|assessment| {
        (assessment.state == "succeeded"
            && assessment.sample_size >= 8
            && assessment.distinct_channels >= 3
            && assessment.comparison_cohort_size >= 3
            && matches!(assessment.format.as_str(), "long" | "shorts"))
        .then_some(assessment.comparison_score)?
        .filter(|score| score.is_finite() && (0.0..=100.0).contains(score))
    });
    let channel_comparison = market.and_then(|assessment| {
        (assessment.state == "succeeded"
            && assessment.sample_size >= 1
            && assessment.channel_baseline_videos >= 3
            && assessment.channel_baseline_channels >= 1
            && matches!(assessment.format.as_str(), "long" | "shorts"))
        .then_some(assessment.channel_breakout_score)?
        .filter(|score| score.is_finite() && (0.0..=100.0).contains(score))
    });
    let youtube_score = session_comparison.or(channel_comparison);
    let trend_change_percent = trends.and_then(|assessment| {
        if assessment.state != "succeeded" || assessment.points < 26 {
            return None;
        }
        assessment
            .change_percent
            .filter(|change| change.is_finite())
    });
    let trend_score = trend_change_percent.map(|change| 50.0 + change.clamp(-100.0, 100.0) * 0.5);
    let coverage_percent =
        u8::from(youtube_score.is_some()) * 75 + u8::from(trend_score.is_some()) * 25;
    let score = youtube_score.map(|youtube| {
        let weighted = match trend_score {
            Some(trend) => youtube * YOUTUBE_WEIGHT + trend * TRENDS_WEIGHT,
            None => youtube,
        };
        weighted.round().clamp(0.0, 100.0) as u8
    });
    ViralPotential {
        score,
        state: if score.is_none() {
            "insufficient_data"
        } else if session_comparison.is_some() && trend_score.is_some() {
            "measured"
        } else {
            "provisional"
        },
        score_version: VERSION,
        confidence: if youtube_score.is_none() {
            "none"
        } else if session_comparison.is_some() && trend_score.is_some() {
            "high"
        } else if session_comparison.is_some()
            || market.is_some_and(|a| a.channel_baseline_channels >= 3 && a.sample_size >= 8)
        {
            "medium"
        } else {
            "low"
        },
        comparison_basis: if session_comparison.is_some() {
            Some("within_session")
        } else if channel_comparison.is_some() {
            Some("channel_baseline")
        } else {
            None
        },
        format: market.map(|assessment| assessment.format.clone()),
        youtube_score,
        trend_score,
        trend_change_percent,
        coverage_percent,
        sample_size: market.map_or(0, |assessment| assessment.sample_size),
        distinct_channels: market.map_or(0, |assessment| assessment.distinct_channels),
        comparison_cohort_size: market.map_or(0, |assessment| assessment.comparison_cohort_size),
        channel_breakout_score: market.and_then(|assessment| assessment.channel_breakout_score),
        channel_baseline_videos: market.map_or(0, |assessment| assessment.channel_baseline_videos),
        channel_baseline_channels: market
            .map_or(0, |assessment| assessment.channel_baseline_channels),
        youtube_observed_at: market.and_then(|assessment| assessment.observed_at),
        trends_observed_at: trends.and_then(|assessment| assessment.observed_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn market(score: Option<f64>) -> IdeaMarketAssessment {
        IdeaMarketAssessment {
            run_id: "run".into(),
            state: "succeeded".into(),
            query: "hidden home costs".into(),
            format: "long".into(),
            search_queries: vec!["hidden home costs".into()],
            metric_version: "youtube-comparables-v1".into(),
            region: "US".into(),
            language: "en".into(),
            observed_at: Some(100),
            next_collection_at: 200,
            searched_videos: 25,
            sample_size: 12,
            distinct_channels: 5,
            median_views: Some(20_000.0),
            p75_views: Some(35_000.0),
            median_views_per_day: Some(52.0),
            recent_uploads90d: 4,
            comparison_score: score,
            comparison_cohort_size: 3,
            channel_breakout_score: None,
            channel_baseline_videos: 0,
            channel_baseline_channels: 0,
            channel_baseline_examples: vec![],
            observed_7d_median_view_delta: None,
            observed_7d_video_count: 0,
            observed_30d_median_view_delta: None,
            observed_30d_video_count: 0,
            error_code: None,
            videos: vec![],
            audience_questions: vec![],
        }
    }

    fn trends(change: Option<f64>) -> GoogleTrendsAssessment {
        GoogleTrendsAssessment {
            state: "succeeded".into(),
            query: "hidden home costs".into(),
            region: "US".into(),
            observed_at: Some(101),
            recent_mean: Some(60.0),
            previous_mean: Some(40.0),
            change_percent: change,
            points: 52,
            metric_version: "google-trends-momentum-v1".into(),
            error_code: None,
        }
    }

    #[test]
    fn both_observations_produce_a_versioned_composite() {
        let result = assess(Some(&market(Some(76.0))), Some(&trends(Some(56.0))));
        assert_eq!(result.score, Some(77)); // 76 * .75 + 78 * .25
        assert_eq!(result.state, "measured");
        assert_eq!(result.youtube_score, Some(76.0));
        assert_eq!(result.trend_score, Some(78.0));
        assert_eq!(result.coverage_percent, 100);
        assert_eq!(result.score_version, "viral-potential-v2");
    }

    #[test]
    fn missing_trends_is_partial_not_an_imputed_flat_trend() {
        let mut unavailable = trends(None);
        unavailable.state = "unavailable".into();
        let result = assess(Some(&market(Some(75.0))), Some(&unavailable));
        assert_eq!(result.score, Some(75));
        assert_eq!(result.state, "provisional");
        assert_eq!(result.trend_score, None);
        assert_eq!(result.coverage_percent, 75);
    }

    #[test]
    fn google_trends_alone_never_fabricates_a_viral_score() {
        let result = assess(None, Some(&trends(Some(80.0))));
        assert_eq!(result.score, None);
        assert_eq!(result.state, "insufficient_data");
        assert_eq!(result.coverage_percent, 25);
    }

    #[test]
    fn weak_youtube_cohorts_and_failed_runs_are_not_scored() {
        let mut weak = market(Some(90.0));
        weak.sample_size = 7;
        assert_eq!(assess(Some(&weak), None).score, None);
        weak.sample_size = 8;
        weak.distinct_channels = 2;
        assert_eq!(assess(Some(&weak), None).score, None);
        weak.distinct_channels = 3;
        weak.comparison_cohort_size = 2;
        assert_eq!(assess(Some(&weak), None).score, None);
        weak.comparison_cohort_size = 3;
        weak.state = "failed".into();
        assert_eq!(assess(Some(&weak), None).score, None);
        weak.state = "succeeded".into();
        weak.comparison_score = Some(f64::NAN);
        assert_eq!(assess(Some(&weak), None).score, None);
    }

    #[test]
    fn trends_are_bounded_and_unavailable_points_do_not_count() {
        assert_eq!(
            assess(Some(&market(Some(60.0))), Some(&trends(Some(-200.0)))).score,
            Some(45)
        );
        assert_eq!(
            assess(Some(&market(Some(60.0))), Some(&trends(Some(200.0)))).score,
            Some(70)
        );
        let mut insufficient = trends(Some(80.0));
        insufficient.points = 25;
        let result = assess(Some(&market(Some(60.0))), Some(&insufficient));
        assert_eq!(result.score, Some(60));
        assert_eq!(result.state, "provisional");
    }

    #[test]
    fn channel_uploads_anchor_a_low_confidence_provisional_score_without_three_other_ideas() {
        let mut sample = market(None);
        sample.sample_size = 3;
        sample.distinct_channels = 1;
        sample.comparison_cohort_size = 0;
        sample.channel_breakout_score = Some(72.0);
        sample.channel_baseline_videos = 8;
        sample.channel_baseline_channels = 1;
        let potential = assess(Some(&sample), None);
        assert_eq!(potential.score, Some(72));
        assert_eq!(potential.confidence, "low");
        assert_eq!(potential.comparison_basis, Some("channel_baseline"));
        assert_eq!(potential.state, "provisional");
        sample.channel_baseline_videos = 2;
        assert_eq!(assess(Some(&sample), None).score, None);
    }
}
