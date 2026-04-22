// Initialisation de la carte (Centrée sur Montréal)
const map = L.map('map').setView([45.52, -73.65], 11);
console.log('Map initialized');

const LIGHT_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const systemThemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const tileLayer = L.tileLayer(LIGHT_TILE_URL, {
    attribution: '© CartoDB, OpenStreetMap, Marguerite Burton, Données Québec, <a href="https://www.quebec.ca/education/indicateurs-statistiques/prescolaire-primaire-secondaire/indices-defavorisation" target="_blank" rel="noopener noreferrer">Ministère de l\'Éducation du Québec</a>',
    maxZoom: 19,
    errorTileUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg'
}).addTo(map);

tileLayer.on('tileerror', function(error) {
    console.error('Tile load error:', error);
});

console.log('Tile layer added');

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    tileLayer.setUrl(isDark ? DARK_TILE_URL : LIGHT_TILE_URL);

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
        themeToggle.setAttribute('aria-label', isDark ? 'Activer le mode clair' : 'Activer le mode sombre');
        themeToggle.textContent = isDark ? '☀️ Mode clair' : '🌙 Mode sombre';
    }
}

function initializeTheme() {
    const prefersDark = systemThemeMediaQuery ? systemThemeMediaQuery.matches : false;
    const initialTheme = prefersDark ? 'dark' : 'light';
    applyTheme(initialTheme);
}

// Mode placement de marqueur
let markerPlacementMode = false;
let addMarkerBtn = null;
let activeMarker = null;

function setActiveMarker(latlng, popupText) {
    if (activeMarker && map.hasLayer(activeMarker)) {
        map.removeLayer(activeMarker);
    }
    activeMarker = L.marker(latlng).addTo(map).bindPopup(popupText).openPopup();
}

function setMarkerPlacementMode(enabled) {
    markerPlacementMode = enabled;
    if (addMarkerBtn) {
        if (enabled) {
            addMarkerBtn.classList.add('active');
            addMarkerBtn.textContent = '🗺️ Cliquez sur la carte';
        } else {
            addMarkerBtn.classList.remove('active');
            addMarkerBtn.textContent = '📍 Ajouter un marqueur';
        }
    }
    map.getContainer().style.cursor = enabled ? 'crosshair' : '';
}

function handleMarkerPlacement(e) {
    if (!markerPlacementMode) return;

    const latlng = e.latlng;
    setMarkerPlacementMode(false);
    map.off('click', handleMarkerPlacement);

    // Ajouter un marqueur à la position cliquée
    setActiveMarker(latlng, 'Position sélectionnée');
    map.setView(latlng, 16);

    // Trouver le polygone contenant cette position
    if (donneesGeoJSON) {
        const matches = [];
        const point = turf.point([latlng.lng, latlng.lat]);
        for (const feature of donneesGeoJSON.features) {
            if (turf.booleanPointInPolygon(point, feature)) {
                matches.push(feature);
            }
        }
        if (matches.length > 0) {
            showSelectedPolygons(matches);
            showInfo(matches);
        } else {
            hideSelectedPolygons();
            showDefaultInfoPanel('Aucun bassin scolaire trouvé à cette position.');
        }
    }
}

window.addEventListener('load', function() {
    map.invalidateSize();
    console.log('Map invalidateSize called');
});

// Variables pour stocker les données et les couches
let donneesGeoJSON;
let ecolesPrimaireGeoJSON;
let csAngGeoJSON;
let csFraGeoJSON;
const commissionBySchoolLookup = new Map();
const polygonLayers = new Map();
let polygonLayerGroup = null;
let selectedPolygonLayers = [];
let selectedSchoolPointsLayer = null;
let csAngLayers = [];
let csFragLayers = [];
let activeCommissionLayers = [];
let frenchSchoolsPointsLayer = null;
let englishSchoolsPointsLayer = null;
let imseGradientPreviewActive = false;
let sfrGradientPreviewActive = false;
const SCHOOL_POINT_DEFAULT_RADIUS = 6;
const SCHOOL_POINT_HIGHLIGHT_RADIUS = 10;
let imseCounts = new Array(11).fill(0);
let sfrCounts = new Array(11).fill(0);
let imseChart = null;
let sfrChart = null;
let lastFocusedElement = null;
const layerVisibilityState = {
    showFrenchSchools: false,
    showEnglishSchools: false,
    showFrenchBoards: false,
    showEnglishBoards: false
};

const schoolPointColors = {
    FR: '#1f78b4',
    EN: '#e31a1c',
    OTHER: '#6c757d'
};

function getFeatureIdentityKey(feature) {
    if (!feature) return '';

    const props = feature.properties || {};
    const featureId = String(feature.id || '').trim();
    const objectId = String(props.OBJECTID1 || props.OBJECTID || props.ObjectId || props.OBJECTID_1 || '').trim();
    const languageCode = getLanguageCode(props);
    const schoolName = normalizeSchoolNameForMatching(getPolygonSchoolName(feature));

    return [featureId, objectId, languageCode, schoolName].join('|');
}

const defaultPolygonStyle = {
    color: 'blue',
    weight: 2,
    opacity: 1,
    fill: false
};

const highlightPolygonStyle = {
    color: 'red',
    weight: 3,
    fill: false
};

function getPolygonStyleForLanguage(languageCode, highlighted = false) {
    if (languageCode === 'EN') {
        return highlighted
            ? { color: '#e31a1c', weight: 4, opacity: 1, fill: false }
            : { color: '#e31a1c', weight: 2, opacity: 0.95, fill: false };
    }

    if (languageCode === 'FR') {
        return highlighted
            ? { color: '#1f78b4', weight: 4, opacity: 1, fill: false }
            : { color: '#1f78b4', weight: 2, opacity: 0.95, fill: false };
    }

    return highlighted ? highlightPolygonStyle : defaultPolygonStyle;
}

function getPolygonStyleForFeature(feature, highlighted = false) {
    const languageCode = getLanguageCode((feature && feature.properties) ? feature.properties : {});
    return getPolygonStyleForLanguage(languageCode, highlighted);
}

function getImseDecileFromFeature(feature) {
    const props = (feature && feature.properties) ? feature.properties : {};
    const decile = Number.parseInt(props.Rang_Decile_IMSE, 10);
    return Number.isInteger(decile) && decile >= 1 && decile <= 10 ? decile : null;
}

function getImseGradientColor(decile) {
    if (!decile) return '#aebbc5';

    const low = { r: 64, g: 145, b: 206 };   // low IMSE decile
    const high = { r: 213, g: 94, b: 98 };   // high IMSE decile
    const t = (decile - 1) / 9;

    const r = Math.round(low.r + (high.r - low.r) * t);
    const g = Math.round(low.g + (high.g - low.g) * t);
    const b = Math.round(low.b + (high.b - low.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function applyImseGradientToSelectedPolygons() {
    if (!selectedPolygonLayers || selectedPolygonLayers.length === 0) return;

    imseGradientPreviewActive = true;
    sfrGradientPreviewActive = false;
    selectedPolygonLayers.forEach(layer => {
        const baseStyle = getPolygonStyleForFeature(layer.feature, true);
        const decile = getImseDecileFromFeature(layer.feature);
        layer.setStyle({
            ...baseStyle,
            fill: true,
            fillOpacity: 0.45,
            fillColor: getImseGradientColor(decile)
        });
    });
}

function clearImseGradientFromSelectedPolygons() {
    imseGradientPreviewActive = false;
    if (!selectedPolygonLayers || selectedPolygonLayers.length === 0) return;

    selectedPolygonLayers.forEach(layer => {
        layer.setStyle(getPolygonStyleForFeature(layer.feature, true));
    });
}

function getSfrDecileFromFeature(feature) {
    const props = (feature && feature.properties) ? feature.properties : {};
    const decile = Number.parseInt(props.Rang_Decile_SFR, 10);
    return Number.isInteger(decile) && decile >= 1 && decile <= 10 ? decile : null;
}

function getSfrGradientColor(decile) {
    if (!decile) return '#aebbc5';

    const low = { r: 69, g: 170, b: 124 };   // low SFR decile
    const high = { r: 194, g: 110, b: 188 }; // high SFR decile
    const t = (decile - 1) / 9;

    const r = Math.round(low.r + (high.r - low.r) * t);
    const g = Math.round(low.g + (high.g - low.g) * t);
    const b = Math.round(low.b + (high.b - low.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function applySfrGradientToSelectedPolygons() {
    if (!selectedPolygonLayers || selectedPolygonLayers.length === 0) return;

    sfrGradientPreviewActive = true;
    imseGradientPreviewActive = false;
    selectedPolygonLayers.forEach(layer => {
        const baseStyle = getPolygonStyleForFeature(layer.feature, true);
        const decile = getSfrDecileFromFeature(layer.feature);
        layer.setStyle({
            ...baseStyle,
            fill: true,
            fillOpacity: 0.45,
            fillColor: getSfrGradientColor(decile)
        });
    });
}

function clearSfrGradientFromSelectedPolygons() {
    sfrGradientPreviewActive = false;
    if (!selectedPolygonLayers || selectedPolygonLayers.length === 0) return;

    selectedPolygonLayers.forEach(layer => {
        layer.setStyle(getPolygonStyleForFeature(layer.feature, true));
    });
}

const csAngStyle = {
    color: '#f0a8a8',
    weight: 2,
    opacity: 0.9,
    fill: true,
    fillOpacity: 0.01
};

const csFraStyle = {
    color: '#8bb8e0',
    weight: 2,
    opacity: 0.9,
    fill: true,
    fillOpacity: 0.01
};

function getCommissionScolaireNameFromProperties(props) {
    if (!props) return '';
    const raw = props.Nom_Cs || props.Nom_cs || props.NOM_CS || props.Nom_CS || props.NomCs || '';
    if (!raw) return '';

    // Strip trailing numeric code(s) like "(762000)", "- 762000", or repeated variants.
    return String(raw)
        .replace(/(?:\s*[\-–:]?\s*\(\d{3,}\)\s*)+$/g, '')
        .replace(/\s*[\-–:]?\s*\d{3,}\s*$/g, '')
        .trim();
}

function getCommissionScolaireWebsiteFromProperties(props) {
    if (!props) return '';
    const rawUrl = props.SITE_WEB || props.Site_Web || props.site_web || props.Website || props.website || props.URL || props.url || '';
    if (!rawUrl) return '';
    const trimmedUrl = String(rawUrl).trim();
    if (!trimmedUrl) return '';
    if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl;
    return `https://${trimmedUrl}`;
}

function getCommissionInfoFromProperties(props) {
    return {
        name: getCommissionScolaireNameFromProperties(props),
        website: getCommissionScolaireWebsiteFromProperties(props)
    };
}

function getCommissionCodeFromProperties(props) {
    if (!props) return '';

    const directCode = props.Code_Cs || props.Code_CS || props.CD_CS || props.CD_Cs || props.code_cs || '';
    if (directCode) return String(directCode).trim();

    const commissionName = String(props.Nom_Cs || props.NOM_CS || '').trim();
    const codeMatch = commissionName.match(/\((\d{3,})\)\s*$/);
    return codeMatch ? codeMatch[1] : '';
}

function getAllCommissionFeatures() {
    const allCommissionFeatures = [];
    if (csFraGeoJSON && Array.isArray(csFraGeoJSON.features)) {
        allCommissionFeatures.push(...csFraGeoJSON.features);
    }
    if (csAngGeoJSON && Array.isArray(csAngGeoJSON.features)) {
        allCommissionFeatures.push(...csAngGeoJSON.features);
    }
    return allCommissionFeatures;
}

function getCommissionNameAliasKey(name) {
    const normalized = normalizeSearchText(name);
    if (!normalized) return '';

    // Reduce known naming variants to a common comparable key.
    return normalized
        .replace(/\bcentre\s+de\s+services\s+scolaire\b/g, ' ')
        .replace(/\bcommission\s+scolaire\b/g, ' ')
        .replace(/\bcss\b/g, ' ')
        .replace(/\bcs\b/g, ' ')
        .replace(/\bde\b|\bdu\b|\bdes\b|\bla\b|\ble\b|\bd\b|\bl\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function addCommissionLookupEntry(rawKey, commissionInfo) {
    const key = normalizeSearchText(rawKey);
    if (!key || !commissionInfo || !commissionInfo.name) return;
    if (!commissionBySchoolLookup.has(key)) {
        commissionBySchoolLookup.set(key, commissionInfo);
        return;
    }

    const existingInfo = commissionBySchoolLookup.get(key);
    if (existingInfo && !existingInfo.website && commissionInfo.website) {
        commissionBySchoolLookup.set(key, {
            ...existingInfo,
            website: commissionInfo.website
        });
    }
}

function buildCommissionLookupFromEcolesPrimaire() {
    commissionBySchoolLookup.clear();
    if (!ecolesPrimaireGeoJSON || !Array.isArray(ecolesPrimaireGeoJSON.features)) return;

    for (const feature of ecolesPrimaireGeoJSON.features) {
        const props = feature.properties || {};
        const commissionInfo = getCommissionInfoFromProperties(props);
        if (!commissionInfo.name) continue;

        // Nom_Org contains name + code, e.g. "École Armand-Lavergne (762002)"
        // Store both the full value and the version with the code stripped
        addCommissionLookupEntry(props.Nom_Org, commissionInfo);
        if (props.Nom_Org) {
            const nameOnly = props.Nom_Org.replace(/\s*\(\d+\)\s*$/, '').trim();
            addCommissionLookupEntry(nameOnly, commissionInfo);
        }
        addCommissionLookupEntry(props.Nom_École, commissionInfo);
        addCommissionLookupEntry(props['Nom_École'], commissionInfo);
        addCommissionLookupEntry(props['Nom_Ã‰cole'], commissionInfo);
        addCommissionLookupEntry(props.Nom_Ecole, commissionInfo);
    }
    console.log('Commission lookup built:', commissionBySchoolLookup.size, 'entries');
}

function findCommissionScolaireInfoFromEcolesPrimaire(feature) {
    const props = (feature && feature.properties) ? feature.properties : (feature || {});
    const candidates = [
        props.Nom_Org,
        props.Nom_École,
        props['Nom_École'],
        props['Nom_Ã‰cole'],
        props.Nom_Ecole
    ];

    for (const candidate of candidates) {
        const key = normalizeSearchText(candidate);
        if (key && commissionBySchoolLookup.has(key)) {
            return commissionBySchoolLookup.get(key);
        }
    }

    return null;
}

function findCommissionScolaireWebsiteByName(commissionName) {
    const normalizedName = normalizeSearchText(commissionName);
    if (!normalizedName) return '';
    const aliasKey = getCommissionNameAliasKey(commissionName);
    const aliasTokens = aliasKey ? aliasKey.split(' ').filter(token => token.length >= 3) : [];

    // 1) Strict normalized name match first.
    for (const feature of getAllCommissionFeatures()) {
        const info = getCommissionInfoFromProperties((feature && feature.properties) ? feature.properties : {});
        if (normalizeSearchText(info.name) === normalizedName && info.website) {
            return info.website;
        }
    }

    // 2) Alias key match handles variants like "CSS de Montréal" vs
    //    "Centre de services scolaire de Montréal".
    for (const feature of getAllCommissionFeatures()) {
        const info = getCommissionInfoFromProperties((feature && feature.properties) ? feature.properties : {});
        if (!info.website) continue;
        if (getCommissionNameAliasKey(info.name) === aliasKey && aliasKey) {
            return info.website;
        }
    }

    // 3) Token containment fallback for partial but distinctive matches.
    if (aliasTokens.length > 0) {
        for (const feature of getAllCommissionFeatures()) {
            const info = getCommissionInfoFromProperties((feature && feature.properties) ? feature.properties : {});
            if (!info.website) continue;
            const candidateAliasKey = getCommissionNameAliasKey(info.name);
            const candidateTokens = candidateAliasKey ? candidateAliasKey.split(' ') : [];
            const containsAllAliasTokens = aliasTokens.every(token => candidateTokens.includes(token));
            if (containsAllAliasTokens) {
                return info.website;
            }
        }
    }

    return '';
}

function findCommissionScolaireInfoByCode(commissionCode) {
    const normalizedCode = String(commissionCode || '').trim();
    if (!normalizedCode) return null;

    for (const feature of getAllCommissionFeatures()) {
        const props = (feature && feature.properties) ? feature.properties : {};
        const featureCode = getCommissionCodeFromProperties(props);
        if (featureCode && featureCode === normalizedCode) {
            return getCommissionInfoFromProperties(props);
        }
    }

    return null;
}

function findCommissionScolaireInfoForFeature(feature) {
    if (!feature || !feature.geometry) return null;
    if (!csFraGeoJSON && !csAngGeoJSON) return null;

    if (csFraGeoJSON && Array.isArray(csFraGeoJSON.features)) {
        for (const csFeature of csFraGeoJSON.features) {
            if (turf.booleanIntersects(feature, csFeature)) {
                return getCommissionInfoFromProperties(csFeature.properties);
            }
        }
    }

    if (csAngGeoJSON && Array.isArray(csAngGeoJSON.features)) {
        for (const csFeature of csAngGeoJSON.features) {
            if (turf.booleanIntersects(feature, csFeature)) {
                return getCommissionInfoFromProperties(csFeature.properties);
            }
        }
    }

    const point = turf.pointOnFeature(feature);

    if (csFraGeoJSON && Array.isArray(csFraGeoJSON.features)) {
        for (const csFeature of csFraGeoJSON.features) {
            if (turf.booleanPointInPolygon(point, csFeature)) {
                return getCommissionInfoFromProperties(csFeature.properties);
            }
        }
    }

    if (csAngGeoJSON && Array.isArray(csAngGeoJSON.features)) {
        for (const csFeature of csAngGeoJSON.features) {
            if (turf.booleanPointInPolygon(point, csFeature)) {
                return getCommissionInfoFromProperties(csFeature.properties);
            }
        }
    }

    return null;
}

function hideSelectedPolygons() {
    imseGradientPreviewActive = false;
    sfrGradientPreviewActive = false;
    selectedPolygonLayers.forEach(layer => {
        layer.setStyle(getPolygonStyleForFeature(layer.feature, false));
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    selectedPolygonLayers = [];

    if (selectedSchoolPointsLayer && map.hasLayer(selectedSchoolPointsLayer)) {
        map.removeLayer(selectedSchoolPointsLayer);
    }
}

function hideCommissionLayers() {
    activeCommissionLayers.forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    activeCommissionLayers = [];
}

function syncSchoolLayersVisibility() {
    const syncLayer = (layer, shouldShow) => {
        if (!layer) return;
        if (shouldShow) {
            if (!map.hasLayer(layer)) {
                layer.addTo(map);
            }
        } else if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    };

    syncLayer(frenchSchoolsPointsLayer, layerVisibilityState.showFrenchSchools);
    syncLayer(englishSchoolsPointsLayer, layerVisibilityState.showEnglishSchools);
}

function syncCommissionLayersVisibility() {
    const syncLayerGroup = (layers, shouldShow) => {
        layers.forEach(layer => {
            if (shouldShow) {
                if (!map.hasLayer(layer)) {
                    layer.addTo(map);
                }
            } else if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        });
    };

    syncLayerGroup(csFragLayers, layerVisibilityState.showFrenchBoards);
    syncLayerGroup(csAngLayers, layerVisibilityState.showEnglishBoards);
}

function showCommissionLayersForFeature(feature) {
    hideCommissionLayers();
    if (!feature || !feature.geometry) return;

    const point = turf.pointOnFeature(feature);
    const toShow = [];

    for (const layer of csAngLayers) {
        const csFeature = layer.feature;
        if (turf.booleanPointInPolygon(point, csFeature)) {
            toShow.push(layer);
        }
    }

    for (const layer of csFragLayers) {
        const csFeature = layer.feature;
        if (turf.booleanPointInPolygon(point, csFeature)) {
            toShow.push(layer);
        }
    }

    toShow.forEach(layer => {
        layer.addTo(map);
        activeCommissionLayers.push(layer);
    });
}

function getLanguageCode(props) {
    const rawValue = String((props && props.Langue) || '').trim().toUpperCase();
    if (rawValue === 'FR') return 'FR';
    if (rawValue === 'EN') return 'EN';

    const commissionName = String((props && props.Nom_Cs) || '').toLowerCase();
    if (commissionName.includes('english')) return 'EN';
    if (commissionName.includes('franc') || commissionName.includes('scolaire')) return 'FR';

    return 'OTHER';
}

function buildSelectedSchoolPointsLayer(selectedPolygons) {
    if (!ecolesPrimaireGeoJSON || !Array.isArray(ecolesPrimaireGeoJSON.features) || selectedPolygons.length === 0) {
        return null;
    }

    const selectedPolygonDescriptors = selectedPolygons.map(polygonFeature => ({
        feature: polygonFeature,
        languageCode: getLanguageCode((polygonFeature && polygonFeature.properties) ? polygonFeature.properties : {}),
        schoolName: normalizeSchoolNameForMatching(getPolygonSchoolName(polygonFeature))
    }));

    const getMatchingDescriptorsForSchool = (schoolFeature) => {
        const schoolLanguage = getLanguageCode(schoolFeature.properties);
        return selectedPolygonDescriptors.filter(descriptor => {
            if (schoolLanguage !== descriptor.languageCode) {
                return false;
            }
            return turf.booleanPointInPolygon(schoolFeature, descriptor.feature);
        });
    };

    const strictMatches = ecolesPrimaireGeoJSON.features.filter(schoolFeature => {
        if (!schoolFeature || !schoolFeature.geometry || schoolFeature.geometry.type !== 'Point') {
            return false;
        }

        const schoolName = normalizeSchoolNameForMatching(getSchoolNameFromFeature(schoolFeature));
        const matchingPolygonDescriptors = getMatchingDescriptorsForSchool(schoolFeature);

        if (matchingPolygonDescriptors.length === 0) {
            return false;
        }

        return matchingPolygonDescriptors.some(descriptor => descriptor.schoolName && descriptor.schoolName === schoolName);
    });

    const selectedSchoolFeatures = strictMatches.length > 0
        ? strictMatches
        : ecolesPrimaireGeoJSON.features.filter(schoolFeature => {
            if (!schoolFeature || !schoolFeature.geometry || schoolFeature.geometry.type !== 'Point') {
                return false;
            }

            const schoolName = normalizeSchoolNameForMatching(getSchoolNameFromFeature(schoolFeature));
            const matchingPolygonDescriptors = getMatchingDescriptorsForSchool(schoolFeature);
            if (matchingPolygonDescriptors.length === 0) {
                return false;
            }

            // Fallback for legacy datasets where names still differ.
            return matchingPolygonDescriptors.some(descriptor => hasPartialNameMatch(schoolName, descriptor.schoolName));
        });

    return L.geoJSON(selectedSchoolFeatures, {
        pointToLayer: function(feature, latlng) {
            const languageCode = getLanguageCode(feature.properties);
            return L.circleMarker(latlng, {
                radius: SCHOOL_POINT_DEFAULT_RADIUS,
                fillColor: schoolPointColors[languageCode],
                color: '#ffffff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9
            });
        },
        onEachFeature: function(feature, layer) {
            const schoolName = getSchoolNameFromFeature(feature);
            layer.bindPopup(`<strong>${schoolName}</strong>`);
            layer.bindTooltip(schoolName, {
                direction: 'top',
                offset: [0, -6],
                sticky: true
            });
            layer.on('click', function() {
                selectSchool(feature);
            });
        }
    });
}

function showSelectedPolygons(features) {
    hideSelectedPolygons();
    features.forEach(feature => {
        const key = getFeatureIdentityKey(feature);
        const layer = polygonLayers.get(key);
        if (layer) {
            layer.setStyle(getPolygonStyleForFeature(feature, true));
            layer.addTo(map);
            layer.bringToFront();
            selectedPolygonLayers.push(layer);
        }
    });

    if (imseGradientPreviewActive) {
        applyImseGradientToSelectedPolygons();
    } else if (sfrGradientPreviewActive) {
        applySfrGradientToSelectedPolygons();
    }

    selectedSchoolPointsLayer = buildSelectedSchoolPointsLayer(features);
    if (selectedSchoolPointsLayer) {
        selectedSchoolPointsLayer.addTo(map);
    }
}

function showSelectedPolygon(feature) {
    showSelectedPolygons([feature]);
}

function initCharts() {
    const defaultData = new Array(10).fill(0);
    const defaultColors = new Array(10).fill('rgba(54, 162, 235, 0.5)');
    const imseCanvas = document.getElementById('imse-chart');
    const sfrCanvas = document.getElementById('sfr-chart');

    const imseCtx = document.getElementById('imse-chart').getContext('2d');
    imseChart = new Chart(imseCtx, {
        type: 'bar',
        data: {
            labels: ['1','2','3','4','5','6','7','8','9','10'],
            datasets: [{
                label: 'Nombre d\'écoles',
                data: defaultData,
                backgroundColor: defaultColors,
                borderColor: defaultColors.map(color => color.replace('0.5', '1')),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Nombre d\'écoles' } },
                x: { title: { display: true, text: 'Décile IMSE' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    if (imseCanvas) {
        imseCanvas.addEventListener('mouseenter', applyImseGradientToSelectedPolygons);
        imseCanvas.addEventListener('mouseleave', clearImseGradientFromSelectedPolygons);
    }

    const sfrCtx = document.getElementById('sfr-chart').getContext('2d');
    sfrChart = new Chart(sfrCtx, {
        type: 'bar',
        data: {
            labels: ['1','2','3','4','5','6','7','8','9','10'],
            datasets: [{
                label: 'Nombre d\'écoles',
                data: defaultData,
                backgroundColor: defaultColors,
                borderColor: defaultColors.map(color => color.replace('0.5', '1')),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Nombre d\'écoles' } },
                x: { title: { display: true, text: 'Décile SFR' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    if (sfrCanvas) {
        sfrCanvas.addEventListener('mouseenter', applySfrGradientToSelectedPolygons);
        sfrCanvas.addEventListener('mouseleave', clearSfrGradientFromSelectedPolygons);
    }
}

function updateCharts(selectedImse, selectedSfr) {
    // Normalize inputs to arrays
    const selectedImseArray = selectedImse === null ? [] : (Array.isArray(selectedImse) ? selectedImse : [selectedImse]);
    const selectedSfrArray = selectedSfr === null ? [] : (Array.isArray(selectedSfr) ? selectedSfr : [selectedSfr]);
    
    const imseData = imseCounts.slice(1);
    const imseColors = imseData.map((count, index) => 
        selectedImseArray.includes(index + 1) ? 'rgba(255, 99, 132, 0.8)' : 'rgba(54, 162, 235, 0.5)'
    );
    imseChart.data.datasets[0].data = imseData;
    imseChart.data.datasets[0].backgroundColor = imseColors;
    imseChart.data.datasets[0].borderColor = imseColors.map(color => color.replace('0.8', '1').replace('0.5', '1'));
    imseChart.update();
    
    // Update IMSE explanation
    const imseExplanationEl = document.getElementById('imse-explanation');
    if (selectedImseArray.length > 0) {
        const imseDeciles = selectedImseArray.sort((a, b) => a - b);
        const imseText = imseDeciles.length === 1 
            ? `La colonne en rouge indique le rang décile IMSE (${imseDeciles[0]}) de l'école sélectionnée. Ce graphique représente les écoles de la région de Montréal.`
            : `Les colonnes en rouge indiquent les rangs déciles IMSE (${imseDeciles.join(', ')}) des écoles sélectionnées. Ce graphique représente les écoles de la région de Montréal.`;
        imseExplanationEl.textContent = imseText;
    } else {
        imseExplanationEl.textContent = 'Ce graphique montre la répartition des écoles de la région de Montréal par rang décile IMSE. Sélectionnez une école pour surligner sa position.';
    }

    const sfrData = sfrCounts.slice(1);
    const sfrColors = sfrData.map((count, index) => 
        selectedSfrArray.includes(index + 1) ? 'rgba(255, 99, 132, 0.8)' : 'rgba(54, 162, 235, 0.5)'
    );
    sfrChart.data.datasets[0].data = sfrData;
    sfrChart.data.datasets[0].backgroundColor = sfrColors;
    sfrChart.data.datasets[0].borderColor = sfrColors.map(color => color.replace('0.8', '1').replace('0.5', '1'));
    sfrChart.update();
    
    // Update SFR explanation
    const sfrExplanationEl = document.getElementById('sfr-explanation');
    if (selectedSfrArray.length > 0) {
        const sfrDeciles = selectedSfrArray.sort((a, b) => a - b);
        const sfrText = sfrDeciles.length === 1 
            ? `La colonne en rouge indique le rang décile SFR (${sfrDeciles[0]}) de l'école sélectionnée. Ce graphique représente les écoles de la région de Montréal.`
            : `Les colonnes en rouge indiquent les rangs déciles SFR (${sfrDeciles.join(', ')}) des écoles sélectionnées. Ce graphique représente les écoles de la région de Montréal.`;
        sfrExplanationEl.textContent = sfrText;
    } else {
        sfrExplanationEl.textContent = 'Ce graphique montre la répartition des écoles de la région de Montréal par rang décile SFR. Sélectionnez une école pour surligner sa position.';
    }
}

function showDefaultInfoPanel(message = '') {
    const schoolInfoContainer = document.getElementById('school-info');
    const messageBlock = message
        ? `<p class="info-panel-message">${message}</p>`
        : '';

    schoolInfoContainer.innerHTML = `
        ${messageBlock}
        <div class="info-panel-default-card">
            <h4>Comprendre les indicateurs</h4>
            <p><strong>IMSE</strong> est l'indice de milieu socio-économique. Il décrit le contexte socio-économique des élèves desservis par une école.</p>
            <p><strong>SFR</strong> renvoie à la situation de faible revenu. Il aide à situer la proportion d'élèves issus de milieux à plus faible revenu.</p>
            <p>Les graphiques présentent la répartition des écoles par décile. Sélectionnez une école sur la carte pour afficher ses valeurs précises et voir sa position dans les distributions.</p>
            <p>Pour plus d'information à propos des indices de défavorisation : <a href="https://www.quebec.ca/education/indicateurs-statistiques/prescolaire-primaire-secondaire/indices-defavorisation" target="_blank" rel="noopener noreferrer">Indices de défavorisation</a></p>
        </div>
    `;

    document.getElementById('imse-chart').style.display = 'block';
    document.getElementById('sfr-chart').style.display = 'block';
    updateCharts(null, null);
    setInfoPanelOpen(true);
}

initCharts();

// Fonction pour afficher les informations dans le panneau latéral
function showInfo(features) {
    if (!Array.isArray(features)) {
        features = [features];
    }
    const firstProps = features[0].properties;
    console.log('Showing info for:', features.map(f => f.properties.Nom_École || f.properties.Nom_Org).join(', '));
    document.getElementById('imse-chart').style.display = 'block';
    document.getElementById('sfr-chart').style.display = 'block';
    
    const schoolInfo = features.map(featureItem => {
        const title = featureItem.properties ? featureItem.properties.Nom_École || featureItem.properties.Nom_Org : featureItem.Nom_École || featureItem.Nom_Org;
        const p = featureItem.properties || featureItem;
        const commissionCode = getCommissionCodeFromProperties(p);
        const languageCode = getLanguageCode(p);
        const languageLabel = languageCode === 'FR' ? 'Français' : (languageCode === 'EN' ? 'Anglais' : 'Autre');
        const languageClass = languageCode === 'FR' ? 'school-fr' : (languageCode === 'EN' ? 'school-en' : 'school-other');
        const schoolType = (p.Type || '').toString().trim();
        const schoolTypeRow = (languageCode === 'EN' && schoolType)
            ? `<p><strong>Type :</strong> ${schoolType}</p>`
            : '';
        const commissionInfoFromCode = findCommissionScolaireInfoByCode(commissionCode);
        const commissionInfo = commissionInfoFromCode || findCommissionScolaireInfoFromEcolesPrimaire(featureItem) || findCommissionScolaireInfoForFeature(featureItem);
        const nomCommission = commissionInfo && commissionInfo.name ? commissionInfo.name : 'Non disponible';
        const commissionWebsite = (commissionInfoFromCode && commissionInfoFromCode.website)
            || (commissionInfo && commissionInfo.website)
            || findCommissionScolaireWebsiteByName(nomCommission);
        const commissionWebsiteRow = commissionWebsite
            ? `<p><strong>Site web :</strong> <a href="${escapeHtmlAttribute(commissionWebsite)}" target="_blank" rel="noopener noreferrer">${commissionWebsite}</a></p>`
            : '';
        const schoolDataWarningRow = commissionWebsite
            ? `<p class="school-data-warning"><strong>Avertissement :</strong> Les données de certains bassins scolaires peuvent être incomplètes. Pour obtenir l'information la plus précise, consultez le <a href="${escapeHtmlAttribute(commissionWebsite)}" target="_blank" rel="noopener noreferrer">site web du centre de services scolaire</a>.</p>`
            : `<p class="school-data-warning"><strong>Avertissement :</strong> Les données de certains bassins scolaires peuvent être incomplètes. Pour obtenir l'information la plus précise, consultez le site web du centre de services scolaire.</p>`;
        return `
        <details class="accordion-item ${languageClass}" data-school-name="${escapeHtmlAttribute(title)}" data-school-language="${languageCode}" ${features.length === 1 ? 'open' : ''}>
            <summary>
                <span class="school-title">${title}</span>
                <span class="school-language-badge">${languageLabel}</span>
            </summary>
            <div class="accordion-content">
                <p><strong>${nomCommission}</strong></p>
                ${commissionWebsiteRow}
                ${schoolTypeRow}
                <p><strong>IMSE :</strong> ${parseFloat(p.IMSE).toFixed(2)}</p>
                <p><strong>Rang Décile IMSE :</strong> ${p.Rang_Decile_IMSE}</p>
                <p><strong>SFR :</strong> ${parseFloat(p.SFR).toFixed(2)}</p>
                <p><strong>Rang Décile SFR :</strong> ${p.Rang_Decile_SFR}</p>
                <p><strong>Nombre d'élèves :</strong> ${p.Nbre_Eleves}</p>
                ${schoolDataWarningRow}
            </div>
        </details>
        `;
    }).join('');
    const schoolInfoContainer = document.getElementById('school-info');
    schoolInfoContainer.innerHTML = schoolInfo;

    schoolInfoContainer.querySelectorAll('.accordion-item').forEach(item => {
        item.addEventListener('toggle', syncHighlightedSchoolPointsFromPanel);
    });
    
    // Collect all selected schools' decile values
    const selectedImseValues = features.map(f => (f.properties || f).Rang_Decile_IMSE).filter(v => v != null);
    const selectedSfrValues = features.map(f => (f.properties || f).Rang_Decile_SFR).filter(v => v != null);
    
    updateCharts(selectedImseValues.length > 0 ? selectedImseValues : null, selectedSfrValues.length > 0 ? selectedSfrValues : null);
    
    setInfoPanelOpen(true);
    syncHighlightedSchoolPointsFromPanel();
    setTimeout(() => {
        imseChart.resize();
        imseChart.update();
        sfrChart.resize();
        sfrChart.update();
    }, 100);
}

function setInfoPanelOpen(isOpen) {
    const infoPanel = document.getElementById('info-panel');
    const infoPanelTab = document.getElementById('info-panel-tab');

    if (infoPanel) {
        infoPanel.classList.toggle('open', isOpen);
    }

    if (infoPanelTab) {
        infoPanelTab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
}

// Fonction pour masquer le panneau
function hideInfo() {
    setInfoPanelOpen(false);
    hideSelectedPolygons();
    syncHighlightedSchoolPointsFromPanel();

    const infoPanelTab = document.getElementById('info-panel-tab');
    if (infoPanelTab && typeof infoPanelTab.focus === 'function') {
        infoPanelTab.focus();
    }
}

// Événement pour fermer le panneau
document.getElementById('close-panel').addEventListener('click', hideInfo);
const infoPanelTab = document.getElementById('info-panel-tab');
if (infoPanelTab) {
    infoPanelTab.addEventListener('click', function() {
        setInfoPanelOpen(true);
        const panelContent = document.getElementById('panel-content');
        if (panelContent) {
            panelContent.focus();
        }
    });
}
console.log('Close panel event added');

// Ajout de la barre de recherche d'adresse
L.Control.geocoder({
    position: 'topleft',
    defaultMarkGeocode: false
}).on('markgeocode', function(e) {
    const latlng = e.geocode.center;
    
    // Ajouter un marqueur à l'adresse trouvée
    setActiveMarker(latlng, e.geocode.name);
    map.setView(latlng, 16);
    
    // Trouver le polygone contenant cette adresse
    if (donneesGeoJSON) {
        const matches = [];
        const point = turf.point([latlng.lng, latlng.lat]);
        for (const feature of donneesGeoJSON.features) {
            if (turf.booleanPointInPolygon(point, feature)) {
                matches.push(feature);
            }
        }
        if (matches.length > 0) {
            showSelectedPolygons(matches);
            showInfo(matches);
        } else {
            hideSelectedPolygons();
            showDefaultInfoPanel('Aucun bassin scolaire trouvé à cette adresse.');
        }
    }
}).addTo(map);

// Ajout du bouton "Ajouter un marqueur" comme contrôle Leaflet
const AddMarkerControl = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-add-marker');
        addMarkerBtn = L.DomUtil.create('a', '', container);
        addMarkerBtn.href = '#';
        addMarkerBtn.title = 'Ajouter un marqueur';
        addMarkerBtn.textContent = '📍 Ajouter un marqueur';

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(addMarkerBtn, 'click', function(ev) {
            L.DomEvent.stop(ev);
            const enableMode = !markerPlacementMode;
            setMarkerPlacementMode(enableMode);
            if (enableMode) {
                map.on('click', handleMarkerPlacement);
            } else {
                map.off('click', handleMarkerPlacement);
            }
        });

        return container;
    }
});

map.addControl(new AddMarkerControl());

const LayerVisibilityControl = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-layer-toggle');

        container.innerHTML = `
            <details class="layer-toggle-dropdown">
                <summary class="layer-toggle-summary">🗂️ Afficher des couches</summary>
                <div class="layer-toggle-menu">
                    <label class="layer-toggle-option"><input type="checkbox" data-layer-toggle="showFrenchSchools"> Écoles FR</label>
                    <label class="layer-toggle-option"><input type="checkbox" data-layer-toggle="showEnglishSchools"> Écoles EN</label>
                    <label class="layer-toggle-option"><input type="checkbox" data-layer-toggle="showFrenchBoards"> Centres de services scolaires FR</label>
                    <label class="layer-toggle-option"><input type="checkbox" data-layer-toggle="showEnglishBoards"> School boards EN</label>
                </div>
            </details>
        `;

        const syncUI = () => {
            container.querySelectorAll('input[data-layer-toggle]').forEach(input => {
                const key = input.dataset.layerToggle;
                input.checked = !!layerVisibilityState[key];
            });
        };

        container.querySelectorAll('input[data-layer-toggle]').forEach(input => {
            input.addEventListener('change', function() {
                const key = this.dataset.layerToggle;
                layerVisibilityState[key] = this.checked;
                syncSchoolLayersVisibility();
                syncCommissionLayersVisibility();
                syncUI();
            });
        });

        syncUI();

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        return container;
    }
});

function openItineraryToActiveMarker() {
    if (!activeMarker) {
        alert('Sélectionnez d\'abord une école ou un point sur la carte.');
        return;
    }

    const latlng = activeMarker.getLatLng();
    const destination = `${latlng.lat},${latlng.lng}`;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

const ItineraryControl = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-itinerary');
        const itineraryBtn = L.DomUtil.create('button', '', container);
        itineraryBtn.type = 'button';
        itineraryBtn.title = 'Créer un itinéraire';
        itineraryBtn.textContent = '🧭 Créer un itinéraire';

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(itineraryBtn, 'click', function(ev) {
            L.DomEvent.preventDefault(ev);
            L.DomEvent.stopPropagation(ev);
            openItineraryToActiveMarker();
        });

        return container;
    }
});

// Gestion robuste de la localisation: affichage d'un seul marqueur et infos associées
map.on('locationfound', function(e) {
    const latlng = e.latlng;

    // Ajouter/remplacer le marqueur de position
    setActiveMarker(latlng, 'Votre position');
    map.setView(latlng, 16);

    // Trouver le polygone contenant cette position
    if (donneesGeoJSON) {
        const matches = [];
        const point = turf.point([latlng.lng, latlng.lat]);
        for (const feature of donneesGeoJSON.features) {
            if (turf.booleanPointInPolygon(point, feature)) {
                matches.push(feature);
            }
        }
        if (matches.length > 0) {
            showSelectedPolygons(matches);
            showInfo(matches);
        } else {
            hideSelectedPolygons();
            showDefaultInfoPanel('Aucun bassin scolaire trouvé à votre position.');
        }
    }
});

// Ajout du contrôle de localisation
if (typeof L.control.locate === 'function') {
    L.control.locate({
        position: 'topleft',
        drawMarker: false,
        drawCircle: false,
        strings: {
            title: "Me localiser"
        }
    }).addTo(map);
    console.log('Locate control added');
} else {
    console.error('Leaflet LocateControl not loaded');
}

// Fonctions pour gérer la modal de recherche
function openSearchModal() {
    const modal = document.getElementById('school-search-modal');
    const searchInput = document.getElementById('school-search-input');
    if (!modal || !searchInput) return;

    lastFocusedElement = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    searchInput.focus();
    searchInput.value = '';
    updateSearchResults('');
}

function closeSearchModal() {
    const modal = document.getElementById('school-search-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    const mainMap = document.getElementById('map');
    if (mainMap && typeof mainMap.focus === 'function') {
        mainMap.setAttribute('tabindex', '-1');
        mainMap.focus();
    }
}

function trapFocusInModal(event, modalElement) {
    if (!modalElement || !modalElement.classList.contains('open') || event.key !== 'Tab') {
        return;
    }

    const focusableElements = modalElement.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (!focusableElements.length) {
        return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function getSchoolNameFromFeature(feature) {
    const props = (feature && feature.properties) ? feature.properties : {};
    const schoolName = props.Nom_École || props['Nom_École'] || props['Nom_Ã‰cole'] || props.Nom_Ecole || '';
    if (schoolName) return schoolName;
    const orgName = props.Nom_Org || '';
    return orgName ? orgName.replace(/\s*\(\d+\)\s*$/, '').trim() : 'École inconnue';
}

function getPolygonSchoolName(feature) {
    const props = (feature && feature.properties) ? feature.properties : {};
    const schoolName = props.Nom_École || props['Nom_École'] || props['Nom_Ã‰cole'] || props.Nom_Ecole || '';
    if (schoolName) return schoolName;
    const orgName = props.Nom_Org || '';
    return orgName ? orgName.replace(/\s*\(\d+\)\s*$/, '').trim() : '';
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function normalizeSchoolNameForMatching(value) {
    const withoutCode = String(value || '').replace(/\s*\(\d+\)\s*$/, '').trim();
    return normalizeSearchText(withoutCode);
}

function escapeHtmlAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function syncHighlightedSchoolPointsFromPanel() {
    if (!selectedSchoolPointsLayer || !map.hasLayer(selectedSchoolPointsLayer)) {
        return;
    }

    const schoolInfoContainer = document.getElementById('school-info');
    const openItems = schoolInfoContainer
        ? Array.from(schoolInfoContainer.querySelectorAll('.accordion-item[open]'))
        : [];

    const openSchools = openItems.map(item => ({
        name: normalizeSchoolNameForMatching(item.dataset.schoolName || ''),
        language: item.dataset.schoolLanguage || 'OTHER'
    }));

    selectedSchoolPointsLayer.eachLayer(layer => {
        if (!layer || !layer.feature || typeof layer.setStyle !== 'function') {
            return;
        }

        const schoolName = normalizeSchoolNameForMatching(getSchoolNameFromFeature(layer.feature));
        const schoolLanguage = getLanguageCode(layer.feature.properties || {});

        const isHighlighted = openSchools.some(openSchool => {
            if (openSchool.language !== 'OTHER' && openSchool.language !== schoolLanguage) {
                return false;
            }
            return schoolName === openSchool.name;
        });

        layer.setStyle({
            radius: isHighlighted ? SCHOOL_POINT_HIGHLIGHT_RADIUS : SCHOOL_POINT_DEFAULT_RADIUS
        });

        if (isHighlighted && typeof layer.bringToFront === 'function') {
            layer.bringToFront();
        }
    });
}

function hasPartialNameMatch(schoolName, polygonName) {
    const school = normalizeSearchText(schoolName);
    const polygon = normalizeSearchText(polygonName);

    if (!school || !polygon) {
        return false;
    }

    if (school.includes(polygon) || polygon.includes(school)) {
        return true;
    }

    const stopWords = new Set([
        'ecole', 'school', 'elementary', 'primaire', 'de', 'des', 'du', 'la', 'le', 'les', 'the', 'and', 'et'
    ]);

    const tokenize = (name) => name
        .split(/[^a-z0-9]+/)
        .filter(token => token.length >= 3 && !stopWords.has(token));

    const schoolTokens = tokenize(school);
    const polygonTokens = tokenize(polygon);

    if (schoolTokens.length === 0 || polygonTokens.length === 0) {
        return false;
    }

    return schoolTokens.some(schoolToken =>
        polygonTokens.some(polygonToken =>
            schoolToken.includes(polygonToken) || polygonToken.includes(schoolToken)
        )
    );
}

function updateSearchResults(query) {
    const resultsList = document.getElementById('search-results');
    resultsList.innerHTML = '';

    if (!ecolesPrimaireGeoJSON || ecolesPrimaireGeoJSON.features.length === 0) {
        resultsList.innerHTML = '<li class="search-no-results">Données non encore chargées...</li>';
        return;
    }

    const queryNormalized = normalizeSearchText(query);
    const matches = ecolesPrimaireGeoJSON.features.filter(feature => {
        const schoolName = getSchoolNameFromFeature(feature);
        return normalizeSearchText(schoolName).includes(queryNormalized);
    });

    if (matches.length === 0) {
        resultsList.innerHTML = '<li class="search-no-results">Aucune école trouvée</li>';
        return;
    }

    const groupedMatches = new Map();
    matches.forEach(feature => {
        const props = (feature && feature.properties) ? feature.properties : {};
        const boardName = getCommissionScolaireNameFromProperties(props) || 'Centre de services scolaire non précisé';
        if (!groupedMatches.has(boardName)) {
            groupedMatches.set(boardName, []);
        }
        groupedMatches.get(boardName).push(feature);
    });

    const sortedBoardNames = Array.from(groupedMatches.keys()).sort((a, b) =>
        normalizeSearchText(a).localeCompare(normalizeSearchText(b), 'fr')
    );

    sortedBoardNames.forEach(boardName => {
        const header = document.createElement('li');
        header.className = 'search-group-header';
        header.textContent = boardName;
        resultsList.appendChild(header);

        const features = groupedMatches.get(boardName);
        features.sort((a, b) =>
            normalizeSearchText(getSchoolNameFromFeature(a)).localeCompare(normalizeSearchText(getSchoolNameFromFeature(b)), 'fr')
        );

        features.forEach(feature => {
            const li = document.createElement('li');
            li.className = 'search-result-item';
            const schoolName = getSchoolNameFromFeature(feature);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'search-result-button';

            const strong = document.createElement('strong');
            strong.textContent = schoolName;
            button.appendChild(strong);

            button.addEventListener('click', function() {
                selectSchool(feature);
                closeSearchModal();
            });

            li.appendChild(button);
            resultsList.appendChild(li);
        });
    });
}

function selectSchool(feature) {
    const schoolName = getSchoolNameFromFeature(feature);
    const geometry = feature.geometry || {};
    let latlng;

    if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
        latlng = L.latLng(geometry.coordinates[1], geometry.coordinates[0]);
    } else {
        const center = turf.center(feature);
        latlng = L.latLng(center.geometry.coordinates[1], center.geometry.coordinates[0]);
    }
    
    // Placer un marqueur au centre de l'école
    setActiveMarker(latlng, schoolName);
    map.setView(latlng, 16);

    // Trouver et afficher les informations depuis ecoles_montreal
    if (!donneesGeoJSON) {
        return;
    }

    const targetName = normalizeSchoolNameForMatching(schoolName);
    let matches = donneesGeoJSON.features.filter(polyFeature =>
        normalizeSchoolNameForMatching(getPolygonSchoolName(polyFeature)) === targetName
    );

    // Repli spatial si le jumelage par nom échoue
    if (matches.length === 0) {
        const point = turf.point([latlng.lng, latlng.lat]);
        matches = donneesGeoJSON.features.filter(polyFeature => turf.booleanPointInPolygon(point, polyFeature));
    }

    if (matches.length > 0) {
        showSelectedPolygons(matches);
        showInfo(matches);
    } else {
        hideSelectedPolygons();
        showDefaultInfoPanel('Aucun bassin scolaire trouvé pour cette école.');
    }
}

// Ajout du contrôle de recherche d'école
const SearchSchoolControl = L.Control.extend({
    options: {
        position: 'topleft'
    },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-search-school');
        const searchBtn = L.DomUtil.create('button', '', container);
        searchBtn.type = 'button';
        searchBtn.title = 'Rechercher une école';
        searchBtn.textContent = '🔍 Chercher une école';

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(searchBtn, 'click', function(ev) {
            L.DomEvent.preventDefault(ev);
            L.DomEvent.stopPropagation(ev);
            openSearchModal();
        });

        return container;
    }
});

map.addControl(new SearchSchoolControl());
map.addControl(new ItineraryControl());
map.addControl(new LayerVisibilityControl());
console.log('Search school control added');

// Gestion des événements de la modal
window.addEventListener('DOMContentLoaded', function() {
    initializeTheme();

    showDefaultInfoPanel();
    const welcomeModal = document.getElementById('welcome-modal');
    const welcomeCloseBtn = document.getElementById('welcome-modal-close');
    const welcomeStartBtn = document.getElementById('welcome-modal-start');
    const themeToggle = document.getElementById('theme-toggle');

    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            const isDarkNow = document.body.classList.contains('dark-mode');
            const nextTheme = isDarkNow ? 'light' : 'dark';
            applyTheme(nextTheme);
        });
    }

    if (systemThemeMediaQuery) {
        const handleSystemThemeChange = function(event) {
            applyTheme(event.matches ? 'dark' : 'light');
        };

        if (typeof systemThemeMediaQuery.addEventListener === 'function') {
            systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
        } else if (typeof systemThemeMediaQuery.addListener === 'function') {
            // Legacy fallback for older browsers.
            systemThemeMediaQuery.addListener(handleSystemThemeChange);
        }
    }

    if (welcomeModal) {
        welcomeModal.classList.add('open');
        welcomeModal.setAttribute('aria-hidden', 'false');
        welcomeModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeWelcomeModal();
            }
        });
    }

    if (welcomeCloseBtn) {
        welcomeCloseBtn.addEventListener('click', closeWelcomeModal);
    }

    if (welcomeStartBtn) {
        welcomeStartBtn.addEventListener('click', closeWelcomeModal);
    }

    const closeBtn = document.querySelector('.search-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSearchModal);
    }

    const modal = document.getElementById('school-search-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeSearchModal();
            }
        });
    }

    const searchInput = document.getElementById('school-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            updateSearchResults(this.value);
        });
    }

    // Gestion de la touche Échap pour fermer la modal
    document.addEventListener('keydown', function(e) {
        const searchModal = document.getElementById('school-search-modal');
        const isSearchOpen = searchModal && searchModal.classList.contains('open');
        const isWelcomeOpen = welcomeModal && welcomeModal.classList.contains('open');

        if (e.key === 'Tab') {
            if (isSearchOpen) {
                trapFocusInModal(e, searchModal);
            } else if (isWelcomeOpen) {
                trapFocusInModal(e, welcomeModal);
            }
        }

        if (e.key === 'Escape') {
            if (isSearchOpen) closeSearchModal();
            if (isWelcomeOpen) closeWelcomeModal();
        }
    });
});

// Récupération asynchrone des données de bassins (français + anglais)
Promise.all([
    fetch('./data/ecoles_montreal.geojson').then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ecoles_montreal.geojson`);
        }
        return response.json();
    }),
    fetch('./data/ecoles_en.geojson').then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ecoles_en.geojson`);
        }
        return response.json();
    })
])
    .then(([ecolesMontrealData, ecolesEnData]) => {
        const montrealFeatures = (ecolesMontrealData.features || []).map(feature => {
            const props = feature.properties || {};
            const existingLanguage = String(props.Langue || '').trim().toUpperCase();
            return {
                ...feature,
                properties: {
                    ...props,
                    Langue: existingLanguage === 'FR' || existingLanguage === 'EN' ? existingLanguage : 'FR'
                }
            };
        });

        const englishFeatures = (ecolesEnData.features || []).map(feature => {
            const props = feature.properties || {};
            const existingLanguage = String(props.Langue || '').trim().toUpperCase();
            return {
                ...feature,
                properties: {
                    ...props,
                    Langue: existingLanguage === 'FR' || existingLanguage === 'EN' ? existingLanguage : 'EN'
                }
            };
        });

        const mergedFeatures = [
            ...montrealFeatures,
            ...englishFeatures
        ];

        donneesGeoJSON = {
            type: 'FeatureCollection',
            features: mergedFeatures
        };

        console.log(
            'GeoJSON loaded successfully:',
            `${ecolesMontrealData.features.length} french + ${ecolesEnData.features.length} english = ${mergedFeatures.length} features`
        );

        // Calculer les comptages pour les graphiques a partir des 2 sources (FR + EN)
        imseCounts = new Array(11).fill(0);
        sfrCounts = new Array(11).fill(0);

        function addDecileCounts(features, sourceLabel) {
            let countedImse = 0;
            let countedSfr = 0;

            (features || []).forEach(feature => {
                const props = feature.properties || {};
                const imseDecile = Number.parseInt(props.Rang_Decile_IMSE, 10);
                const sfrDecile = Number.parseInt(props.Rang_Decile_SFR, 10);

                if (Number.isInteger(imseDecile) && imseDecile >= 1 && imseDecile <= 10) {
                    imseCounts[imseDecile]++;
                    countedImse++;
                }

                if (Number.isInteger(sfrDecile) && sfrDecile >= 1 && sfrDecile <= 10) {
                    sfrCounts[sfrDecile]++;
                    countedSfr++;
                }
            });

            console.log(`Decile counts from ${sourceLabel}: IMSE=${countedImse}, SFR=${countedSfr}`);
        }

        addDecileCounts(montrealFeatures, 'ecoles_montreal.geojson');
        addDecileCounts(englishFeatures, 'ecoles_en.geojson');

        showDefaultInfoPanel();

        // Préparer les polygones mais ne pas les afficher tout de suite
        polygonLayerGroup = L.geoJSON(donneesGeoJSON, {
            style: function(feature) {
                return getPolygonStyleForFeature(feature, false);
            },
            onEachFeature: function(feature, layer) {
                const key = getFeatureIdentityKey(feature);
                polygonLayers.set(key, layer);
                layer.on('click', function() {
                    showSelectedPolygon(feature);
                    showInfo(feature);
                });
            }
        });

        syncSchoolLayersVisibility();
    })
    .catch(erreur => {
        console.error("Erreur de chargement des données:", erreur);
        alert("Erreur de chargement des données GeoJSON: " + erreur.message);
    });

fetch('./data/Ecole_primaire.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Ecole_primaire loaded successfully:', data.features.length, 'features');
        ecolesPrimaireGeoJSON = data;
        buildCommissionLookupFromEcolesPrimaire();

        const createSchoolPointsLayer = (languageCode) => {
            const features = (ecolesPrimaireGeoJSON.features || []).filter(feature => {
                if (!feature || !feature.geometry || feature.geometry.type !== 'Point') {
                    return false;
                }
                return getLanguageCode(feature.properties || {}) === languageCode;
            });

            return L.geoJSON(features, {
                pointToLayer: function(feature, latlng) {
                    return L.circleMarker(latlng, {
                        radius: SCHOOL_POINT_DEFAULT_RADIUS,
                        fillColor: schoolPointColors[languageCode] || schoolPointColors.OTHER,
                        color: '#ffffff',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.9
                    });
                },
                onEachFeature: function(feature, layer) {
                    const schoolName = getSchoolNameFromFeature(feature);
                    layer.bindPopup(`<strong>${schoolName}</strong>`);
                    layer.bindTooltip(schoolName, {
                        direction: 'top',
                        offset: [0, -6],
                        sticky: true
                    });
                    layer.on('click', function() {
                        selectSchool(feature);
                    });
                }
            });
        };

        frenchSchoolsPointsLayer = createSchoolPointsLayer('FR');
        englishSchoolsPointsLayer = createSchoolPointsLayer('EN');
        syncSchoolLayersVisibility();

        if (selectedPolygonLayers.length > 0) {
            const selectedFeatures = selectedPolygonLayers
                .map(layer => layer.feature)
                .filter(Boolean);
            if (selectedFeatures.length > 0) {
                selectedSchoolPointsLayer = buildSelectedSchoolPointsLayer(selectedFeatures);
                if (selectedSchoolPointsLayer) {
                    selectedSchoolPointsLayer.addTo(map);
                }
            }
        }
    })
    .catch(erreur => {
        console.error("Erreur de chargement de Ecole_primaire:", erreur);
    });

fetch('./data/CS_ANG_data.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        csAngGeoJSON = data;
        const angLayer = L.geoJSON(data, {
            style: csAngStyle,
            interactive: true
        });
        angLayer.eachLayer(layer => {
            const boardName = getCommissionScolaireNameFromProperties((layer.feature && layer.feature.properties) ? layer.feature.properties : {});
            layer.bindPopup(`<strong>${boardName || 'School board'}</strong>`);
            csAngLayers.push(layer);
        });
        syncCommissionLayersVisibility();
        console.log('CS_ANG_data loaded successfully:', data.features.length, 'features');
    })
    .catch(erreur => {
        console.error("Erreur de chargement de CS_ANG_data:", erreur);
    });

fetch('./data/CS_FRA_data.geojson')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        csFraGeoJSON = data;
        const fraLayer = L.geoJSON(data, {
            style: csFraStyle,
            interactive: true
        });
        fraLayer.eachLayer(layer => {
            const boardName = getCommissionScolaireNameFromProperties((layer.feature && layer.feature.properties) ? layer.feature.properties : {});
            layer.bindPopup(`<strong>${boardName || 'Centre de services scolaire'}</strong>`);
            csFragLayers.push(layer);
        });
        syncCommissionLayersVisibility();
        console.log('CS_FRA_data loaded successfully:', data.features.length, 'features');
    })
    .catch(erreur => {
        console.error("Erreur de chargement de CS_FRA_data:", erreur);
    });