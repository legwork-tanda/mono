import PhotosUI
import SwiftUI
import UIKit

/// The finished job (S11 look): what was done, who did it, the final price
/// against the locked range, the job's photos, and the review (S12 look: the
/// form, or what was posted). Mirrors apps/web/components/completion.tsx.
/// There's no payment in the API, so there's no Pay step: the price card shows
/// what the tradie charged.
struct CompletionView: View {
    let model: MatchModel
    let match: MatchState
    let booked: MatchOffer

    @State private var showAllDetails = false

    var body: some View {
        VStack(spacing: LW.Layout.stackGap) {
            summaryCard
            priceCard
            if let review = match.review {
                postedReview(review)
            } else {
                ReviewForm(name: booked.tradie.firstName) { stars, text, photos in
                    try await model.review(stars: stars, text: text, photos: photos)
                }
                .padding(.top, LW.Space.md)
            }
        }
    }

    // MARK: Summary

    private var summaryCard: some View {
        let writeUp = model.writeUp
        let details = writeUp.map { showAllDetails ? $0.details : Array($0.details.prefix(4)) } ?? []
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                DoneBadge()
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(booked.tradie.firstName)'s finished")
                        .lwText(.title2)
                        .accessibilityAddTraits(.isHeader)
                    Text([writeUp?.title, match.timeline.done.map(MatchFormat.clock)].compactMap { $0 }.joined(separator: " · "))
                        .lwText(.caption)
                        .foregroundStyle(LW.Color.text2)
                }
            }
            .accessibilityElement(children: .combine)

            if let writeUp {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What was done").font(.system(size: 13)).foregroundStyle(LW.Color.text3)
                    Text(writeUp.summary).lwText(.callout)
                }
                .accessibilityElement(children: .combine)
                if !details.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(details, id: \.label) { detail in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(detail.label).foregroundStyle(LW.Color.text3)
                                Text(detail.value).foregroundStyle(LW.Color.text)
                            }
                            .lwText(.caption)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                if writeUp.details.count > 4 {
                    Button(showAllDetails ? "Show less" : "Show all \(writeUp.details.count) details") {
                        withAnimation(LW.Motion.ease) { showAllDetails.toggle() }
                    }
                    .buttonStyle(.lwLink)
                }
                Text([writeUp.location, match.neededLabel].compactMap { $0 }.joined(separator: " · "))
                    .lwText(.footnote)
                    .foregroundStyle(LW.Color.text3)
            }

            if let photos = model.job?.photos, !photos.isEmpty {
                LWDivider()
                Text("Photos").font(.system(size: 13)).foregroundStyle(LW.Color.text3)
                PhotoGrid(urls: photos.map { model.imageURL(path: $0.path, withToken: true) }, label: "Job photo")
            }
        }
        .modifier(MatchCard())
    }

    // MARK: Price

    private var priceCard: some View {
        let final = booked.quote ?? match.price.max
        return VStack(alignment: .leading, spacing: 4) {
            TradieRow(tradie: booked.tradie)
                .padding(.bottom, 8)
            LWDivider().padding(.bottom, 4)
            LWPriceRow("Locked range", "\(Self.cents(match.price.min))–\(Self.cents(match.price.max))")
            LWPriceRow("Final price", Self.cents(final), total: true)
            Text("Locked at \(MatchFormat.range(match.price)) when you confirmed.")
                .lwText(.caption)
                .foregroundStyle(LW.Color.text3)
                .padding(.top, 4)
            PriceInRange(price: final, range: match.price)
                .padding(.top, 10)
        }
        .modifier(MatchCard())
    }

    /// Two decimals, as on receipts: "$315.00".
    static func cents(_ amount: Double) -> String {
        "$" + amount.formatted(.number.precision(.fractionLength(2)).grouping(.automatic))
    }

    // MARK: Posted review

    private func postedReview(_ review: MatchState.Review) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                DoneBadge()
                Text("Thanks, your review is posted.")
                    .lwText(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            LWStars(rating: review.stars, size: 18)
            if !review.text.isEmpty {
                Text(review.text).lwText(.callout)
            }
            if !review.photos.isEmpty {
                PhotoGrid(urls: review.photos.map { model.imageURL(path: $0, withToken: false) }, label: "Review photo")
            }
            Text("It'll show on \(booked.tradie.firstName)'s profile for the next customer.")
                .lwText(.caption)
                .foregroundStyle(LW.Color.text2)
        }
        .modifier(MatchCard())
    }
}

/// 44pt yellow circle with an ink check: "done".
private struct DoneBadge: View {
    var size: CGFloat = 44
    var body: some View {
        LWIcon("check", size: size * 0.45)
            .foregroundStyle(LW.Color.onAccent)
            .frame(width: size, height: size)
            .background(LW.Color.accent, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Where the final price sits in the locked range: a glass track with a yellow
/// marker ringed in ink.
private struct PriceInRange: View {
    let price: Double
    let range: PriceRange

    var body: some View {
        let span = max(1, range.max - range.min)
        let fraction = min(1, max(0, (price - range.min) / span))
        VStack(spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(LW.Color.glassInner)
                        .overlay(Capsule().strokeBorder(LW.Color.glassLine, lineWidth: 1))
                        .frame(height: 8)
                    Circle()
                        .fill(LW.Color.accent)
                        .overlay(Circle().strokeBorder(LW.Color.onAccent, lineWidth: 2))
                        .frame(width: 16, height: 16)
                        .offset(x: (geo.size.width - 16) * fraction)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 16)
            HStack {
                Text(MatchFormat.money(range.min))
                Spacer()
                Text(MatchFormat.money(range.max))
            }
            .lwText(.footnote)
            .monospacedDigit()
            .foregroundStyle(LW.Color.text3)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Inside the locked range of \(MatchFormat.range(range))")
    }
}

/// Square thumbnails; tap one to see it full size.
private struct PhotoGrid: View {
    let urls: [URL]
    let label: String
    @State private var shown: Shown?

    private struct Shown: Identifiable {
        let url: URL
        var id: String { url.absoluteString }
    }

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
            ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                Button {
                    shown = Shown(url: url)
                } label: {
                    LW.Color.glassInner
                        .aspectRatio(1, contentMode: .fit)
                        .overlay {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill().grayscale(1)
                            } placeholder: {
                                LW.Color.glassInner
                            }
                        }
                        .clipShape(.rect(cornerRadius: LW.Radius.sm, style: .continuous))
                }
                .buttonStyle(.lwPlain)
                .accessibilityLabel("\(label) \(index + 1)")
            }
        }
        .sheet(item: $shown) { photo in
            AsyncImage(url: photo.url) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                LWTapeLoader(label: "Loading photo").frame(width: 120)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.ignoresSafeArea())
            .overlay(alignment: .topTrailing) {
                LWIconButton(icon: "x", label: "Close", style: .onPhoto) { shown = nil }
                    .padding(16)
            }
        }
    }
}

/// S12: 1 to 5 ink stars, what went well (or could be better), a note, and up
/// to three photos of the finished work. The API takes stars, text and
/// photos, so the picked tags lead the review text.
private struct ReviewForm: View {
    let name: String
    let submit: (Int, String, [Data]) async throws -> Void

    private struct Picked: Identifiable {
        let id = UUID()
        let jpeg: Data
        let preview: UIImage
    }

    private static let goodTags = ["On time", "Tidy", "Explained the fix", "Fair price", "Would book again"]
    private static let badTags = ["Late", "Messy", "Didn't explain", "Price higher than quoted", "Had to come back"]

    @State private var stars = 0
    @State private var tags: Set<String> = []
    @State private var text = ""
    @State private var photos: [Picked] = []
    @State private var selection: [PhotosPickerItem] = []
    @State private var preparing = false
    @State private var saving = false
    @State private var error: String?

    private var low: Bool { stars > 0 && stars <= 3 }
    private var shownTags: [String] { low ? Self.badTags : Self.goodTags }

    var body: some View {
        VStack(spacing: LW.Space.md) {
            VStack(spacing: 14) {
                LWAvatar(name: name, size: 80)
                Text("How did \(name) go?")
                    .lwText(.title1)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                LWStarInput(rating: $stars)
            }
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 14) {
                LWSectionLabel(low ? "What could be better?" : "What went well?")
                LWChipFlow(spacing: 8) {
                    ForEach(shownTags, id: \.self) { tag in
                        LWChip(tag, isOn: tags.contains(tag), compact: true) {
                            if tags.contains(tag) { tags.remove(tag) } else { tags.insert(tag) }
                        }
                    }
                }

                TextField("Add a note (optional)", text: $text, axis: .vertical)
                    .lineLimit(3...6)
                    .lwField(minHeight: 72)
                    .onChange(of: text) { if text.count > reviewTextMax { text = String(text.prefix(reviewTextMax)) } }

                if !photos.isEmpty {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                            Color.clear
                                .aspectRatio(1, contentMode: .fit)
                                .overlay { Image(uiImage: photo.preview).resizable().scaledToFill() }
                                .clipShape(.rect(cornerRadius: LW.Radius.sm, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    LWIconButton(icon: "x", label: "Remove photo \(index + 1)", style: .glass, size: 30) {
                                        photos.removeAll { $0.id == photo.id }
                                    }
                                }
                                .accessibilityElement(children: .contain)
                                .accessibilityLabel("Review photo \(index + 1)")
                        }
                    }
                }

                if photos.count < maxReviewPhotos {
                    // The label closure isn't main-actor isolated, so read the state first.
                    let preparing = preparing
                    let count = photos.count
                    PhotosPicker(selection: $selection, maxSelectionCount: maxReviewPhotos - photos.count,
                                 selectionBehavior: .ordered, matching: .images) {
                        AddPhotoLabel(preparing: preparing, count: count)
                    }
                    .buttonStyle(.lwPlain)
                    .disabled(preparing)
                }
            }
            .padding(LW.Layout.glassPadding)
            .lwGlass()
            .lwRing(error != nil)
            .onChange(of: selection) { Task { await addSelection() } }
            .onChange(of: low) { tags = [] }

            if let error {
                LWErrorNote(error).frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await post() }
            } label: {
                Text(saving ? "Sending…" : "Send rating")
            }
            .buttonStyle(.lwPrimary)
            .disabled(stars == 0 || saving || preparing)
        }
    }

    private func addSelection() async {
        let items = selection
        guard !items.isEmpty else { return }
        selection = []
        preparing = true
        defer { preparing = false }
        for item in items.prefix(maxReviewPhotos - photos.count) {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                error = "Couldn't read one of those photos."
                continue
            }
            guard let prepared = await ReviewPhoto.prepare(data) else {
                error = "One of those photos couldn't be used. Try another."
                continue
            }
            photos.append(Picked(jpeg: prepared.jpeg, preview: prepared.preview))
        }
    }

    /// The picked tags (in the order shown), then the note.
    private var reviewText: String {
        let tagLine = shownTags.filter(tags.contains).joined(separator: " · ")
        let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return String([tagLine, note].filter { !$0.isEmpty }.joined(separator: "\n").prefix(reviewTextMax))
    }

    private func post() async {
        guard stars > 0 else {
            error = "Tap a star to rate."
            return
        }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await submit(stars, reviewText, photos.map(\.jpeg))
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// "Add a photo" with the count, as a row in the review card.
private struct AddPhotoLabel: View {
    let preparing: Bool
    let count: Int

    var body: some View {
        HStack(spacing: 8) {
            LWIcon("camera", size: 20)
            Text(preparing ? "Adding…" : count == 0 ? "Add a photo" : "Add another photo")
                .lwText(.subhead)
            Spacer()
            Text("\(count)/\(maxReviewPhotos)")
                .lwText(.footnote)
                .monospacedDigit()
                .foregroundStyle(LW.Color.text3)
        }
        .foregroundStyle(LW.Color.text)
        .frame(minHeight: LW.Size.tapMin)
        .contentShape(.rect)
    }
}

/// Shrinks a picked photo to a JPEG well under the API's 5 MB limit, as the
/// web app's `preparePhoto` does.
enum ReviewPhoto {
    struct Prepared: @unchecked Sendable {
        let jpeg: Data
        let preview: UIImage
    }

    @concurrent
    static func prepare(_ data: Data, maxSide: CGFloat = 2000) async -> Prepared? {
        guard let image = UIImage(data: data) else { return nil }
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        guard let resized = await image.byPreparingThumbnail(ofSize: size) else { return nil }
        for quality in [0.8, 0.6, 0.4] {
            if let jpeg = resized.jpegData(compressionQuality: quality), jpeg.count <= reviewPhotoMaxBytes {
                return Prepared(jpeg: jpeg, preview: resized)
            }
        }
        return nil
    }
}

/// The glass panel used across the match screens (radius 26, padding 18).
struct MatchCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(LW.Color.text)
            .padding(LW.Layout.glassPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .lwGlass()
    }
}
