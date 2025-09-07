"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReasonCategory = exports.IntentState = void 0;
var IntentState;
(function (IntentState) {
    IntentState["RECEIVED"] = "RECEIVED";
    IntentState["SCREENED"] = "SCREENED";
    IntentState["VALIDATED"] = "VALIDATED";
    IntentState["ENRICHED"] = "ENRICHED";
    IntentState["QUEUED"] = "QUEUED";
    IntentState["SUBMITTED"] = "SUBMITTED";
    IntentState["INCLUDED"] = "INCLUDED";
    IntentState["DROPPED"] = "DROPPED";
    IntentState["REJECTED"] = "REJECTED";
})(IntentState || (exports.IntentState = IntentState = {}));
var ReasonCategory;
(function (ReasonCategory) {
    ReasonCategory["CLIENT"] = "CLIENT";
    ReasonCategory["SCREEN"] = "SCREEN";
    ReasonCategory["VALIDATION"] = "VALIDATION";
    ReasonCategory["POLICY"] = "POLICY";
    ReasonCategory["QUEUE"] = "QUEUE";
    ReasonCategory["SUBMIT"] = "SUBMIT";
    ReasonCategory["NETWORK"] = "NETWORK";
    ReasonCategory["INTERNAL"] = "INTERNAL";
})(ReasonCategory || (exports.ReasonCategory = ReasonCategory = {}));
