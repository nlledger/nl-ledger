// Search-engine helpers: titles, descriptions and structured data (JSON-LD) shared by the page builders.
import { SITE, fit } from "../lib/format.mjs";

// Licences of the sources. The site's code is MIT; the data stays under each publisher's licence (README).
export const LICENSE = {
  provincial: "https://www.gov.nl.ca/disclaimer/",
  assembly: "https://www.assembly.nl.ca/CopyrightPrivacyStatement.aspx",
  federal: "https://open.canada.ca/en/open-government-licence-canada",
};

export const ORG = { "@type": "Organization", name: SITE.name, url: SITE.url, logo: `${SITE.url}/nl-ledger-icon-256.png` };

// Keep a name inside a title budget without cutting a word in half.
export function clip(s, n) {
  s = String(s || "");
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…";
}

// A share-card description: whole sentences, at most 155 characters, no ellipsis.
export const desc = (s) => fit(s, 155);

export function siteLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE.name,
      alternateName: "nlledger",
      url: `${SITE.url}/`,
      description: SITE.tagline,
      inLanguage: "en-CA",
      publisher: { "@type": "Organization", name: SITE.name, url: SITE.url },
      potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${SITE.url}/search/?q={search_term_string}` }, "query-input": "required name=search_term_string" },
    },
    { "@context": "https://schema.org", ...ORG, description: "An independent project gathering provincial accounts and federal records linked to NL addresses, with sources and location evidence." },
  ];
}

// A Dataset. `files` are the site's own JSON files; `license` is the publisher's licence URL or a list of them.
// Google rejects a Dataset without a description of 50 to 5000 characters and flags one without a creator or licence,
// so a call that cannot supply them fails the build here instead of reaching the page.
export function datasetLd({ name, description, path, license, period, spatialCoverage, files = [], publishers = [] }) {
  const text = String(description || "");
  if (text.length < 50 || text.length > 5000) throw new Error(`Dataset ${path}: description must be 50 to 5000 characters (got ${text.length})`);
  if (!license || (Array.isArray(license) && !license.length)) throw new Error(`Dataset ${path}: license is required`);
  const d = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url: `${SITE.url}${path}`,
    inLanguage: "en-CA",
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE.name, url: SITE.url },
    license,
  };
  if (spatialCoverage) d.spatialCoverage = spatialCoverage;
  if (period) d.temporalCoverage = period;
  // The publishers' pages are cited, not described: a CreativeWork is not validated as a Dataset of its own.
  if (publishers.length) d.isBasedOn = publishers.map((p) => ({ "@type": "CreativeWork", name: p.name, url: p.url }));
  if (files.length) d.distribution = files.map((f) => ({ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE.url}${f}` }));
  return d;
}

// A Person, only for people the source publishes by name in their public role (an MHA or a minister).
export function personLd({ name, path, jobTitle, description }) {
  return { "@context": "https://schema.org", "@type": "Person", name, url: `${SITE.url}${path}`, jobTitle, description, worksFor: { "@type": "GovernmentOrganization", name: "Government of Newfoundland and Labrador" } };
}

export function orgPageLd({ name, path, description }) {
  return { "@context": "https://schema.org", "@type": "Organization", name, url: `${SITE.url}${path}`, description };
}
