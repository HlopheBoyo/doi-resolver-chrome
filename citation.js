/*!
	Copyright (C) 2016 Matthew D. Mower

	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		 http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.
*/

document.addEventListener('DOMContentLoaded', function () {
	storage(true);
}, false);

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	switch (request.cmd) {
	case "sync_toggle_complete":
		storage(false);
		break;
	default:
		break;
	}
});

function storage(firstRun) {
	if (typeof storage.area === 'undefined') {
		storage.area = chrome.storage.local;
	}

	chrome.storage.local.get(["sync_data"], function(stg) {
		if (stg.sync_data === true) {
			storage.area = chrome.storage.sync;
		} else {
			storage.area = chrome.storage.local;
		}

		if (firstRun === true) {
			continueOnLoad();
		}
	});
}

function continueOnLoad() {
	initializeDoiInput();
	getLocalMessages();
	initSelections();
	populateHistory();
	startListeners();
}

function startListeners() {
	document.getElementById("citeForm").addEventListener("submit", function (event) {
		formSubmitHandler();
		event.preventDefault();
	});

	chrome.tabs.getCurrent(function(tab) {
		var tabRecord = chrome.extension.getBackgroundPage().tabRecord;
		tabRecord(tab.id, true);
	});
}

function queryStringToJSON(query) {
	if (!query) {
		return {};
	}

	var result = {};
	var pairs = query.slice(1).split('&');
	pairs.forEach(function(pair) {
		pair = pair.split('=');
		result[pair[0]] = decodeURIComponent(pair[1] || '');
	});

	return JSON.parse(JSON.stringify(result));
}

function initializeDoiInput() {
	document.getElementById("doiInput").value = queryStringToJSON(location.search).doi || '';
}

function getLocales() {
	return fetch("csl_locales/locales.json")
	.then(function(response) {
		return response.json();
	})
	.catch(function(error) {
		console.error("Unable to read locales", error);
		return {"primary-dialects": {"en": "en-US"}, "language-names": {"en-US": ["English (US)", "English (US)"]}};
	});
}

function getStyles() {
	return fetch("/cite_styles.json")
	.then(function(response) {
		return response.json();
	})
	.catch(function(error) {
		console.error("Unable to read styles", error);
		return {"cite_styles": [{"code": "bibtex", "title": "BibTeX generic citation style", "default_locale": "en-US"}]};
	});
}

function initSelections() {
	var localesPromise = getLocales();
	var stylesPromise = getStyles();

	Promise.all([localesPromise, stylesPromise])
	.then(function(response) {
		var locales = response[0];
		var styles = response[1];
		buildSelections(locales, styles);
	});
}

function buildSelections(cslLocales, cslStyles) {
	var stgFetch = [
		"cite_locale",
		"cite_style"
	];

	storage.area.get(stgFetch, function(stg) {
		var storedLocale = stg.cite_locale;
		var storedStyle = stg.cite_style;
		var allLocales = Object.values(cslLocales["primary-dialects"]);
		var allStyles = cslStyles.cite_styles;

		if (allLocales.indexOf(storedLocale) < 0) {
			storedLocale = "auto";
			chrome.storage.local.set({cite_locale: "auto"}, null);
		}

		/* TODO: Offer option to display locales in their native language;
		   Retrieved with localesMap[allLocales[i]][0]] */
		var localesMap = cslLocales["language-names"];
		var readableLocales = [];
		for (var i = 0; i < allLocales.length; i++) {
			readableLocales[i] = [allLocales[i], localesMap[allLocales[i]][1]];
		}

		readableLocales.sort( function( a, b ) {
			if (a[1] == b[1]) {
				return 0;
			}
			return a[1] < b[1] ? -1 : 1;
		});

		function generateOption(value, html, selected, defaultLocale) {
			var option = document.createElement("option");
			option.setAttribute("value", value);
			option.innerHTML = html;
			if (selected) {
				option.setAttribute("selected", "");
			}
			if (defaultLocale) {
				option.setAttribute("data-locale", defaultLocale);
			}
			return option;
		}

		var localeOption = generateOption("auto", "Auto", "auto" === storedLocale);
		var citeLocaleInput = document.getElementById("citeLocaleInput");
		citeLocaleInput.appendChild(localeOption);

		readableLocales.forEach(function(readableLocale) {
			localeOption = generateOption(readableLocale[0], readableLocale[1], readableLocale[0] === storedLocale);
			citeLocaleInput.appendChild(localeOption);
		});

		var allStyleCodes = Array.from(allStyles, function(item) {
			return item.code;
		});

		// Style not found or "other" (migration)
		if (allStyleCodes.indexOf(storedStyle) < 0) {
			storedStyle = chrome.extension.getBackgroundPage().getDefaultOption("cite_style");
			chrome.storage.local.set({cite_style: storedStyle}, null);
		}

		var styleList = document.getElementById("styleList");
		allStyles.forEach(function(style) {
			var styleOption = generateOption(style.code, style.title, style.code === storedStyle, style.default_locale);
			styleList.appendChild(styleOption);
		});

		if (styleList.selectedOptions.length > 0) {
			styleList.selectedOptions[0].scrollIntoView();
		}

		var filter = document.getElementById("citeStyleFilter");
		filter.addEventListener('input', function() {
			filterByText(styleList, this.value);
		});
	});
}

function filterByText(select, text) {
	var options = Array.from(select.options);
	var showAll = !text;

	if (showAll) {
		options.forEach(function(option) {
			option.style.display = 'block';
		});
		if (select.selectedOptions.length > 0) {
			select.selectedOptions[0].scrollIntoView();
		}
	} else {
		// Escape special chars
		var search = text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
		// Ignore extra whitespace characters
		search = search.replace(/\s* /g, '\\s*');
		var regex = new RegExp(search, 'gi');

		var visibleOptions = [];
		options.forEach(function(option) {
			if (regex.test(option.innerHTML)) {
				option.style.display = 'block';
				visibleOptions.push(option);
			} else {
				option.selected = false;
				option.style.display = 'none';
			}
		});

		if (visibleOptions.length > 0) {
			if (select.selectedOptions.length === 0) {
				visibleOptions[0].selected = true;
			}
			select.selectedOptions[0].scrollIntoView();
		}
	}
}

function formSubmitHandler() {
	var trim = chrome.extension.getBackgroundPage().trim;
	var doi = encodeURI(trim(document.getElementById("doiInput").value));

	if (!document.getElementById("styleList").value) {
		return;
	}

	var checkValidDoi = chrome.extension.getBackgroundPage().checkValidDoi;
	if (!checkValidDoi(doi)) {
		simpleNotification(chrome.i18n.getMessage("invalidDoiAlert"));
		return;
	}

	var recordDoi = chrome.extension.getBackgroundPage().recordDoi;
	recordDoi(doi)
	.catch((errMsg) => {
		console.log(errMsg);
	});

	saveSelections();
	getCitation(doi);
}

function saveSelections() {
	var options = {
		cite_style: document.getElementById("styleList").value,
		cite_locale: document.getElementById("citeLocaleInput").value
	};

	chrome.storage.local.set(options, null);
}

function resetSpace() {
	var notifyDiv = document.getElementById("notifyDiv");
	notifyDiv.innerHTML = "";
	notifyDiv.style.display = "none";
	var citeDiv = document.getElementById("citeDiv");
	citeDiv.innerHTML = "";
	citeDiv.style.display = "none";
}

function simpleNotification(message) {
	resetSpace();
	var notifyDiv = document.getElementById("notifyDiv");
	notifyDiv.innerHTML = message;
	notifyDiv.style.display = "block";
}

function outputCitation(message) {
	resetSpace();
	var citeDiv = document.getElementById("citeDiv");
	citeDiv.innerHTML = message;
	citeDiv.style.display = "block";
}

function getCitation(doi) {
	var styleList = document.getElementById("styleList");
	var style = styleList.value;
	var locale = document.getElementById("citeLocaleInput").value;
	var defaultLocale = styleList.selectedOptions[0].getAttribute('data-locale');

	if (!style || !locale) {
		return;
	}

	simpleNotification(chrome.i18n.getMessage("loading"));

	chrome.permissions.request({
		origins: [
			'https://*.doi.org/',
			'https://*.crossref.org/',
			'https://*.datacite.org/',
			'https://raw.githubusercontent.com/'
		]
	}, function(granted) {
		if (granted) {
			var fetchHeaders = new Headers();
			fetchHeaders.append("Accept", "application/citeproc+json");

			var fetchInit = {
				method: 'GET',
				headers: fetchHeaders
			};

			var fetchRequest = new Request("https://dx.doi.org/" + doi, fetchInit);

			fetch(fetchRequest)
			.then(function(response) {
				return response.json();
			})
			.then(function(json) {
				renderBib(json, style, locale, defaultLocale);
			})
			.catch(function(error) {
				console.log("Unable to find citation JSON.", error);
				simpleNotification(chrome.i18n.getMessage("noCitationFound"));
			});

		} else {
			simpleNotification(chrome.i18n.getMessage("needCitationPerm"));
		}
	});
}

function getStyleCsl(filename) {
	console.time("Style CSL download");
	return fetch("https://raw.githubusercontent.com/citation-style-language/styles/master/" + filename + ".csl")
	.then(function(response) {
		console.timeEnd("Style CSL download");
		return response.text();
	});
}

function getLocaleXml(locale) {
	console.time("Locale XML download");
	return fetch("https://raw.githubusercontent.com/citation-style-language/locales/master/locales-" + locale + ".xml")
	.then(function(response) {
		console.timeEnd("Locale XML download");
		return response.text();
	});
}

function renderBib(citation, style, locale, defaultLocale) {
	// origin: raw.githubusercontent.com permission already handled at button press

	var forceLang = true;

	if (locale === "auto") {
		// Default to en-US in case a defaultLocale is not defined
		locale = defaultLocale || "en-US";
		forceLang = false;
	}

	var styleCslPromise = getStyleCsl(style)
	.catch(function(error) {
		console.error("Unable to find style CSL", error);
		simpleNotification(chrome.i18n.getMessage("citeStyleLoadFailP1") + style + chrome.i18n.getMessage("citeStyleLoadFailP2"));
	});

	var localeXmlPromise = getLocaleXml(locale)
	.catch(function(error) {
		console.error("Unable to find locale XML", error);
		simpleNotification(chrome.i18n.getMessage("citeLocaleLoadFailP1") + locale + chrome.i18n.getMessage("citeLocaleLoadFailP2"));
	});

	Promise.all([styleCslPromise, localeXmlPromise])
	.then(function(response) {
		var cslResponse = response[0];
		var locResponse = response[1];

		if (!cslResponse) {
			console.error("Invalid style XML");
			simpleNotification(chrome.i18n.getMessage("citeStyleLoadFailP1") + style + chrome.i18n.getMessage("citeStyleLoadFailP2"));
			return;
		}

		if (!locResponse) {
			console.error("Invalid locale XML");
			simpleNotification(chrome.i18n.getMessage("citeLocaleLoadFailP1") + locale + chrome.i18n.getMessage("citeLocaleLoadFailP2"));
			return;
		}

		citation.id = "Item-1";
		var citations = { "Item-1": citation };

		var citeprocSys = {
			retrieveLocale: function(locale) {
				return locResponse;
			},
			retrieveItem: function(id) {
				return citations[id];
			}
		};

		var citeproc;
		if (forceLang) {
			citeproc = new CSL.Engine(citeprocSys, cslResponse, locale, forceLang);
		} else {
			citeproc = new CSL.Engine(citeprocSys, cslResponse);
		}

		var itemIDs = [];
		for (var key in citations) {
			if (citations.hasOwnProperty(key)) {
				itemIDs.push(key);
			}
		}
		citeproc.updateItems(itemIDs);

		var bibResult = citeproc.makeBibliography();
		if (bibResult) {
			outputCitation(bibResult[1].join('\n'));
		} else {
			simpleNotification(chrome.i18n.getMessage("citeStyleGenFail"));
		}
	});
}

function populateHistory() {
	var stgFetch = [
		"recorded_dois",
		"history_showsave"
	];

	storage.area.get(stgFetch, function(stg) {
		if (!Array.isArray(stg.recorded_dois)) {
			return;
		}

		// Skip holes in the array (should not occur)
		stg.recorded_dois = stg.recorded_dois.filter(function(recorded_doi) {
			return Boolean(recorded_doi);
		});

		var optionHtml = "";
		var message = chrome.i18n.getMessage("historySavedEntryLabel");
		var i;
		for (i = 0; i < stg.recorded_dois.length; i++) {
			if (stg.recorded_dois[i].save) {
				optionHtml += '<option value="' + stg.recorded_dois[i].doi + '" label="' + message + '" />';
			}
		}
		if (stg.history_showsave !== true) {
			for (i = 0; i < stg.recorded_dois.length; i++) {
				if (!stg.recorded_dois[i].save) {
					optionHtml += '<option value="' + stg.recorded_dois[i].doi + '" />';
				}
			}
		}
		document.getElementById("doiHistory").innerHTML = optionHtml;
	});
}

function getLocalMessages() {
	var message = chrome.i18n.getMessage("citeHeading");
	document.title = message;

	var messageIds = [
		"doiInputLabel",
		"citeHeading",
		"citeLocaleLabel",
		"citeStyleFilterLabel",
		"citeSubHeading",
		"submitButton"
	];

	for (var i = 0; i < messageIds.length; i++) {
		message = chrome.i18n.getMessage(messageIds[i]);
		document.getElementById(messageIds[i]).innerHTML = message;
	}
}
