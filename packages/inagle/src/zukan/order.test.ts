import { describe, expect, test } from "bun:test";
import { parseZukanOrderHtml } from "./order";

describe("parseZukanOrderHtml", () => {
	test("conserve ordre et filtres officiels de la carte", () => {
		const html = `<ul class="charaListBox"><li>
			<div class="nameBox"><span class="name">Shawn Froste</span></div>
			<div class="detailBox"><div class="lBox"><figure><picture>
				<img src="https://dxi4wb638ujep.cloudfront.net/1/k/o/p/opancch54ie.png" alt="Shawn Froste">
			</picture></figure><div class="name"><span class="nickname">Froste</span></div></div>
			<div class="rBox"><dl class="appearedWorks"><dt>Game:</dt><dd>Inazuma Eleven 2: Firestorm / Blizzard</dd></dl>
			<p class="description">The north's best striker is usually cool<br>and calm.</p>
			<ul class="param"><li><dl><dt>Position</dt><dd><p>DF</p></dd></dl>
			<dl><dt>Element</dt><dd><p>Wind</p></dd></dl></li></ul>
			<ul class="basic">
				<li><dl><dt>Age Group</dt><dd>Middle School</dd></dl></li>
				<li><dl><dt>School Year</dt><dd>Grade 8</dd></dl></li>
				<li><dl><dt>Gender</dt><dd>Male</dd></dl></li>
				<li><dl><dt>Character Role</dt><dd>Player</dd></dl></li>
			</ul></div></div></li></ul>`;

		expect(parseZukanOrderHtml(html, 1161)).toEqual([
			{
				ageGroup: "Middle School",
				characterRole: "Player",
				description: "The north's best striker is usually cool and calm.",
				element: "Wind",
				game: "Inazuma Eleven 2: Firestorm / Blizzard",
				gender: "Male",
				id: "k/o/p/opancch54ie",
				name: "Shawn Froste",
				nickname: "Froste",
				order: 1161,
				position: "DF",
				schoolYear: "Grade 8",
				zukanHash: "k/o/p/opancch54ie",
			},
		]);
	});
});
