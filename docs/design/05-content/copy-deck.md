# Copy deck

Every string in the customer app, by screen ID. Use these exactly. Anything in `{braces}` is a variable.

**Voice:** plain, calm and short. No gendered pronouns for tradies: repeat the first name instead. Talk like a helpful neighbour, not a brand. Australian English (colour, organise), AUD, and "tradie" is fine. Money is always explicit about what's charged and when. No exclamation marks, no emoji.

**Formats**
- **Money:** `$95` in flow, and `$95.00` on pay and receipt screens. Always say "inc GST" where an amount is approved or paid.
- **Time windows:** "2–4 pm" (en dash, a space before am/pm). "between 2:05 and 2:25 pm" for arrival.
- **Dates:** "Thu 27 Nov". Add the year only on receipts.
- **Names:** first name in running copy ("Sam"); full name on the tradie card ("Sam Okoro"); first name and initial in lists ("Sam O.").

---

## S01 · Home
| Key | Copy |
|---|---|
| home.jobs.label | Your jobs |
| home.completed | Completed |
| home.row.needs_action | Approve extra work · ${amount} |
| home.row.needs_action.cta | Review |
| home.row.en_route | {tradie} is on the way |
| home.row.en_route.sub | {job} · {minutes} min |
| home.row.on_site | {tradie} is working on it |
| home.row.booked.sub | {tradie} · {day} {window} |
| home.see_all | See all ({count}) |
| home.headline | What needs fixing? |
| home.describe.placeholder | Describe it in your own words… |
| home.offline | You're offline. Showing your last update. |
| a11y.mic | Describe by voice |

## S02 · Describe
| Key | Copy |
|---|---|
| nav.new_job | New job |
| steps.booking | Describe · When · Check · Book |
| describe.opening | What's going on? Type, talk or add a photo. |
| describe.understood.tag | What I understood |
| describe.understood.yes | Yes, that's it |
| describe.understood.no | Not quite |
| describe.not_quite.reply | No worries. What did I get wrong? |
| describe.composer.placeholder | Add more detail… |
| describe.thinking | Thinking… |
| describe.photo.failed | Didn't send. Tap to retry. |
| describe.emergency | If anyone's in danger, call 000. |
| describe.discard.title | Discard this job? |
| describe.discard.body | You'll lose what you've written and your photos. |
| describe.discard.confirm | Discard |
| describe.discard.cancel | Keep editing |

## S03 · When
| Key | Copy |
|---|---|
| when.title | When should someone come? |
| when.today | Today |
| when.today.detail | {count} {trade}s are free this afternoon or evening. |
| when.today.none | No {trade}s free today |
| when.tomorrow | Tomorrow |
| when.tomorrow.detail | Morning, afternoon or evening. |
| when.pick | Pick a day |
| when.pick.detail | Choose a time in the next two weeks. |
| when.price | ${fee} call-out |
| cta.continue | Continue |

## S04 · Check
| Key | Copy |
|---|---|
| check.title | Ready to send? |
| check.your_job | Your job |
| check.edit | Edit |
| check.price | ${fee} call-out · nothing charged yet |
| check.send | Send request |
| check.sending | Sending… |
| check.error | Couldn't send. Check your connection and try again. |

## S05 · Home · sent (new row)
| Key | Copy |
|---|---|
| home.row.requested | Request sent |
| home.row.requested.sub | {job} · waiting for a yes |
| home.row.requested.widened | Still looking · widened to 10 km |
| home.row.accepted | {tradie} can come {day} |
| home.row.accepted.cta | Book |
| home.row.none | No {trade}s free right now |
| home.row.none.cta | Pick a time |
| a11y.sent | Request sent. Waiting for a {trade}. |

## S05b · Request status (sheet)
| Key | Copy |
|---|---|
| request.title | Finding a {trade} |
| request.sub | {job} · Job {number} |
| request.status.sent | Sent to {count} licensed {trade}s |
| request.status.waiting | Waiting for a yes… |
| request.status.yes | {tradie} said yes |
| request.price | ${fee} call-out · nothing charged yet |
| request.reassure | Usually under 2 minutes. We'll text you, so you can close the app. |
| request.widen | Still looking. We've widened the search to 10 km. |
| request.widen.cta | Try another time |
| request.none | No {trade}s are free right now. |
| request.none.cta | Pick another time |
| request.cancel | Cancel request |
| request.cancel.confirm.title | Cancel this request? |
| request.cancel.confirm.body | Nothing has been charged. |
| request.cancel.confirm.yes | Cancel request |
| request.cancel.confirm.no | Keep waiting |
| a11y.loader | Waiting for a reply |

## S06 · Match + time
| Key | Copy |
|---|---|
| match.count | {count} {trade}s said yes |
| match.count.one | {tradie} said yes |
| match.meta | ★ {rating} · {jobs} jobs · {km} km away |
| match.badge.licensed | Licensed |
| match.badge.insured | Insured |
| match.slots.title | Pick a time today |
| match.slot.surcharge | {window} · +${amount} |
| match.price | ${fee} call-out · typical ${low}–${high} |
| match.others | {count} others |
| match.cta | Book {tradie} for {window} |
| match.withdrawn | {old} is no longer free. Here's {new}. |

## S07 · Booked
| Key | Copy |
|---|---|
| booked.title | You're booked. |
| booked.body.today | {tradie} comes today between {start} and {end}. We'll message you when {tradie} is on the way. |
| booked.body.later | {tradie} comes {day} between {start} and {end}. |
| booked.pin | Door PIN |
| booked.pin.hint | Check it before you let {tradie} in |
| booked.hold | ${fee} call-out held, not charged |
| booked.job | Job {number} |
| booked.track | Track {tradie} |
| booked.calendar | Add to calendar |
| booked.done | Done |

## S08 · On the way
| Key | Copy |
|---|---|
| steps.job | Booked · On the way · Arrived · Done |
| track.title | {tradie} is on the way |
| track.window | Arriving between {start} and {end} |
| track.late | Running about {minutes} min late |
| track.pin.hint | {tradie} says it at the door |
| track.call | Call |
| track.message | Message |
| track.safety | Safety |
| track.working | {tradie}'s working on it |

## S09 · At the door
| Key | Copy |
|---|---|
| door.nav | {tradie}'s here |
| door.title | Check before you open the door |
| door.body | Ask {tradie} for your PIN. The job starts once {tradie} enters it. |
| door.pin.label | Your PIN |
| door.safety | If the face, name or PIN don't match, don't open the door. Tap the lifebuoy for help. |
| door.pin_trouble | {tradie}'s had trouble with the PIN. Call {tradie} before opening the door. |
| door.call | Call {tradie} |

## S10 · Extra work
| Key | Copy |
|---|---|
| extra.nav | Job in progress |
| extra.title | {tradie} needs your OK |
| extra.label | Extra work |
| extra.inc_gst | inc GST |
| extra.new_total.label | New total if approved, for about {duration} |
| extra.approve | Approve ${amount} |
| extra.ask | Ask {tradie} |
| extra.decline | Decline |
| extra.decline.confirm | {tradie} will finish the original job only. |
| extra.approved.toast | Approved. {tradie}'s been told. |
| extra.expired | This request expired. {tradie} can send it again. |

## S11 · Done · pay
| Key | Copy |
|---|---|
| pay.nav | Job done |
| pay.title | {tradie}'s finished |
| pay.done_label | What was done |
| pay.photos | Photos |
| pay.row.callout | Call-out |
| pay.row.labour | Labour · {hours} hr |
| pay.row.approved | {item} · approved {time} |
| pay.total | Total |
| pay.gst | Includes GST |
| pay.method.change | Change |
| pay.hold_note | Your ${fee} hold is part of this total, not extra. |
| pay.cta | Pay ${total} |
| pay.paying | Paying… |
| pay.declined | Your card was declined. Try another card. |
| pay.problem | Something's not right |

## S12 · Rate
| Key | Copy |
|---|---|
| rate.nav | Paid · ${total} |
| rate.title | How did {tradie} go? |
| rate.good.title | What went well? |
| rate.good.tags | On time · Tidy · Explained the fix · Fair price · Would book again |
| rate.bad.title | What could be better? |
| rate.bad.tags | Late · Messy · Didn't explain · Price higher than quoted · Had to come back |
| rate.note | Add a note (optional) |
| rate.photo | Add a photo |
| rate.hide_name | Hide my name |
| rate.cta | Send rating |
| rate.skip | Skip |
| rate.help | Get help with this job |
| rate.thanks.toast | Thanks. Your receipt is in your email. |

## S13 · Completed jobs
| Key | Copy |
|---|---|
| completed.nav | Completed |
| completed.summary | {count} jobs · ${total} this year |
| completed.receipts | Receipts |
| completed.row.sub | {tradie} · {date} · ${amount} |
| completed.rate | Rate |
| completed.hint | Tap a job for the receipt, photos and to rate it. |
| completed.empty | No finished jobs yet. They'll show up here with receipts. |

## S14 · Completed job
| Key | Copy |
|---|---|
| past.sub | Done · {date} |
| past.rate.prompt | How did {tradie} go? |
| past.rate.note | Add a note |
| past.receipt | Receipt |
| past.message | Message |
| past.rebook | Book {tradie} again |
| past.rebook.unavailable | Book a new {trade} |

---

## Push notifications and SMS
| Event | Title | Body |
|---|---|---|
| Tradie accepted | {tradie} can come {day}, {window} | Tap to book. |
| No one yet (10 min) | Still looking | We've widened the search. We'll let you know. |
| Booked (SMS) | — | Legwork: {tradie} is booked for {day} {window}. Your door PIN is {pin}. Don't open the door without it. |
| On the way | {tradie} is on the way | Arriving between {start} and {end}. |
| Running late | {tradie} is running late | New window: {start}–{end}. |
| Arrived | {tradie}'s at your door | Check the PIN before you open it. |
| Extra work | {tradie} needs your OK | ${amount} for {item}. Nothing's charged until you approve. |
| Job done | {tradie}'s finished | Check what was done and pay. |
| Receipt (email subject) | Your Legwork receipt · {job} · ${total} | — |

## System errors
| Key | Copy |
|---|---|
| error.offline | You're offline. We'll send it when you're back. |
| error.generic | Something went wrong on our side. Try again. |
| error.address | We couldn't find that address. |
| error.photo_too_big | That photo's too big. Try a smaller one. |
| error.payment | Your card was declined. Try another card. |
