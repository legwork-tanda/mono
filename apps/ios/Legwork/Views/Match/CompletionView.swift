import PhotosUI
import SwiftUI
import UIKit

/// The finished job: what was done, who did it, the final price against the
/// locked range, the job's photos, and the review (the form, or what was
/// posted). Mirrors apps/web/components/completion.tsx.
struct CompletionView: View {
    let model: MatchModel
    let match: MatchState
    let booked: MatchOffer

    @State private var showAllDetails = false

    var body: some View {
        VStack(spacing: 16) {
            if let writeUp = model.writeUp { whatWasDone(writeUp) }
            priceCard
            reviewCard
        }
    }

    private func whatWasDone(_ writeUp: JobWriteUp) -> some View {
        let details = showAllDetails ? writeUp.details : Array(writeUp.details.prefix(4))
        return VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(match.timeline.done.map { "Completed · \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Completed")
            } icon: {
                Image(systemName: "checkmark.circle.fill")
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.green)

            Text(writeUp.title).font(.title3.weight(.semibold)).foregroundStyle(.ink)
            Text(writeUp.summary).foregroundStyle(.secondary)
            if !details.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(details, id: \.label) { detail in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(detail.label).foregroundStyle(.secondary)
                            Text(detail.value)
                        }
                        .font(.subheadline)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if writeUp.details.count > 4 {
                Button(showAllDetails ? "Show less" : "Show all \(writeUp.details.count) details") {
                    withAnimation { showAllDetails.toggle() }
                }
                .font(.subheadline.weight(.semibold))
            }
            Text([writeUp.location, match.tier.label, MatchFormat.day(match.date)].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)

            if let photos = model.job?.photos, !photos.isEmpty {
                PhotoGrid(urls: photos.map { model.imageURL(path: $0.path, withToken: true) }, label: "Job photo")
                    .padding(.top, 4)
            }
        }
        .modifier(MatchCard())
    }

    private var priceCard: some View {
        let final = booked.quote ?? match.price.max
        return VStack(alignment: .leading, spacing: 14) {
            TradieRow(tradie: booked.tradie)
            Divider()
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Final price").font(.headline)
                    Text("Locked at \(MatchFormat.range(match.price)) when you confirmed")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(MatchFormat.money(final)).font(.title.weight(.semibold)).monospacedDigit()
            }
            .accessibilityElement(children: .combine)
            PriceInRange(price: final, range: match.price)
        }
        .modifier(MatchCard())
    }

    @ViewBuilder
    private var reviewCard: some View {
        Group {
            if let review = match.review {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Thanks, your review is posted.", systemImage: "checkmark.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.green)
                    StarRow(stars: review.stars)
                    if !review.text.isEmpty { Text(review.text) }
                    if !review.photos.isEmpty {
                        PhotoGrid(urls: review.photos.map { model.imageURL(path: $0, withToken: false) }, label: "Review photo")
                    }
                    Text("It'll show on \(booked.tradie.firstName)'s profile for the next customer.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                ReviewForm(name: booked.tradie.firstName) { stars, text, photos in
                    try await model.review(stars: stars, text: text, photos: photos)
                }
            }
        }
        .modifier(MatchCard())
    }
}

/// Where the final price sits in the locked range: a bar with a marker.
private struct PriceInRange: View {
    let price: Double
    let range: PriceRange

    var body: some View {
        let span = max(1, range.max - range.min)
        let fraction = min(1, max(0, (price - range.min) / span))
        VStack(spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.brandSoft)
                    Circle()
                        .fill(Color.brand)
                        .frame(width: 14, height: 14)
                        .offset(x: (geo.size.width - 14) * fraction)
                }
            }
            .frame(height: 14)
            HStack {
                Text(MatchFormat.money(range.min))
                Spacer()
                Text(MatchFormat.money(range.max))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
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
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                Button {
                    shown = Shown(url: url)
                } label: {
                    Color.secondary.opacity(0.12)
                        .aspectRatio(1, contentMode: .fit)
                        .overlay {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                ProgressView()
                            }
                        }
                        .clipShape(.rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(label) \(index + 1)")
            }
        }
        .sheet(item: $shown) { photo in
            NavigationStack {
                AsyncImage(url: photo.url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done", systemImage: "xmark") { shown = nil }
                    }
                }
            }
        }
    }
}

/// 1 to 5 stars, a few words, and up to three photos of the finished work.
private struct ReviewForm: View {
    let name: String
    let submit: (Int, String, [Data]) async throws -> Void

    private struct Picked: Identifiable {
        let id = UUID()
        let jpeg: Data
        let preview: UIImage
    }

    @State private var stars = 0
    @State private var text = ""
    @State private var photos: [Picked] = []
    @State private var selection: [PhotosPickerItem] = []
    @State private var preparing = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("How did \(name) go?").font(.headline)

            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { n in
                    Button {
                        stars = n
                    } label: {
                        Image(systemName: n <= stars ? "star.fill" : "star")
                            .font(.largeTitle)
                            .foregroundStyle(n <= stars ? Color.orange : Color.secondary.opacity(0.4))
                            .symbolEffect(.bounce, value: stars == n)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(n) star\(n == 1 ? "" : "s")")
                    .accessibilityAddTraits(stars == n ? .isSelected : [])
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Rating")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: stars = min(5, stars + 1)
                case .decrement: stars = max(1, stars - 1)
                @unknown default: break
                }
            }

            TextField("A few words for the next customer (optional)", text: $text, axis: .vertical)
                .lineLimit(3...6)
                .padding(12)
                .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 14))
                .onChange(of: text) { if text.count > reviewTextMax { text = String(text.prefix(reviewTextMax)) } }

            VStack(alignment: .leading, spacing: 8) {
                Text("Photos of the finished work (optional, up to \(maxReviewPhotos))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay { Image(uiImage: photo.preview).resizable().scaledToFill() }
                            .clipShape(.rect(cornerRadius: 12))
                            .overlay(alignment: .topTrailing) {
                                Button {
                                    photos.removeAll { $0.id == photo.id }
                                } label: {
                                    Image(systemName: "xmark").font(.caption.weight(.bold)).frame(width: 18, height: 18)
                                }
                                .buttonStyle(.glass)
                                .buttonBorderShape(.circle)
                                .padding(4)
                                .accessibilityLabel("Remove photo \(index + 1)")
                            }
                            .accessibilityElement(children: .contain)
                            .accessibilityLabel("Review photo \(index + 1)")
                    }
                    if photos.count < maxReviewPhotos {
                        // The label closure isn't main-actor isolated, so read the state first.
                        let preparing = preparing
                        PhotosPicker(selection: $selection, maxSelectionCount: maxReviewPhotos - photos.count,
                                     selectionBehavior: .ordered, matching: .images) {
                            VStack(spacing: 4) {
                                if preparing { ProgressView() } else { Image(systemName: "camera").font(.title3) }
                                Text("Add photo").font(.footnote.weight(.semibold))
                            }
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.secondary.opacity(0.5)))
                        }
                        .disabled(preparing)
                    }
                }
            }
            .onChange(of: selection) { Task { await addSelection() } }

            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }

            Button {
                Task { await post() }
            } label: {
                HStack {
                    if saving { ProgressView() }
                    Text("Post review")
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 32)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(saving || preparing)
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

    private func post() async {
        guard stars > 0 else {
            error = "Tap a star to rate."
            return
        }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await submit(stars, text.trimmingCharacters(in: .whitespacesAndNewlines), photos.map(\.jpeg))
        } catch {
            self.error = error.localizedDescription
        }
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

/// The white rounded card used across the match screens.
struct MatchCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: .rect(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.secondary.opacity(0.15)))
    }
}
