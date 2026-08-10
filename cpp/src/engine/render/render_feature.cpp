/// @file render_feature.cpp
/// Implementation des helpers ARenderFeature (whitelist/blacklist).

#include "iecode/engine/render/render_feature.h"

namespace lives::render {

bool ARenderFeature::is_enabled_for(DrawPass pass) const noexcept {
    switch (policy_) {
        case FeatureExecutionPolicy::ALWAYS:
            return true;
        case FeatureExecutionPolicy::NEVER:
        case FeatureExecutionPolicy::FRAME_EVENTS_ONLY:
            return false;
        case FeatureExecutionPolicy::WHITELIST_ONLY:
            return whitelist_.contains(pass);
        case FeatureExecutionPolicy::DEFAULT:
        default:
            return !blacklist_.contains(pass);
    }
}

ARenderFeature& ARenderFeature::except(DrawPass pass) {
    blacklist_.insert(pass);
    return *this;
}

ARenderFeature& ARenderFeature::include(DrawPass pass) {
    whitelist_.insert(pass);
    return *this;
}

} // namespace lives::render
