import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Shrinks a photo to at most 1600px on its long edge and re-encodes it as
/// JPEG, like `preparePhoto` in apps/web/lib/photos.ts. Keeps uploads small on
/// mobile data and turns HEIC into a format the API accepts.
enum PhotoPreparer {
    static let maxEdge = 1600

    struct Failed: LocalizedError {
        var errorDescription: String? { "Couldn't read that photo. Try another one." }
    }

    static func jpeg(from data: Data) async throws -> Data {
        try await Task.detached(priority: .userInitiated) { try encode(data) }.value
    }

    private static func encode(_ data: Data) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw Failed() }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw Failed() }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw Failed()
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Failed() }
        return output as Data
    }
}

// MARK: - Sources

/// The library picker and the camera, presented from whatever asks for them.
/// Loads the picked items and hands their data over.
private struct PhotoSourcing: ViewModifier {
    let remaining: Int
    @Binding var showLibrary: Bool
    @Binding var showCamera: Bool
    let onAdd: ([Data]) -> Void

    @State private var items: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .photosPicker(
                isPresented: $showLibrary,
                selection: $items,
                maxSelectionCount: max(1, remaining),
                selectionBehavior: .ordered,
                matching: .images
            )
            .onChange(of: items) { _, picked in
                guard !picked.isEmpty else { return }
                items = []
                Task {
                    var loaded: [Data] = []
                    for item in picked {
                        if let data = try? await item.loadTransferable(type: Data.self) { loaded.append(data) }
                    }
                    if !loaded.isEmpty { onAdd(loaded) }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    if let data = image.jpegData(compressionQuality: 0.9) { onAdd([data]) }
                }
                .ignoresSafeArea()
            }
    }
}

@MainActor private var deviceHasCamera: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

/// "Take a photo" and "Library" as glass pills, for the photos question.
struct PhotoSourceButtons: View {
    /// How many more photos fit.
    let remaining: Int
    let onAdd: ([Data]) -> Void

    @State private var showLibrary = false
    @State private var showCamera = false

    var body: some View {
        HStack(spacing: LW.Layout.stackGap) {
            if deviceHasCamera {
                Button { showCamera = true } label: {
                    HStack(spacing: 8) { LWIcon("camera"); Text("Take a photo") }
                }
                .buttonStyle(.lwSecondary)
            }
            Button { showLibrary = true } label: {
                HStack(spacing: 8) { LWIcon("image"); Text(deviceHasCamera ? "Library" : "Choose photos") }
            }
            .buttonStyle(.lwSecondary)
        }
        .disabled(remaining <= 0)
        .modifier(PhotoSourcing(remaining: remaining, showLibrary: $showLibrary, showCamera: $showCamera, onAdd: onAdd))
    }
}

/// The camera icon in the chat composer: take a photo or choose from the library.
struct PhotoMenuButton: View {
    let remaining: Int
    let onAdd: ([Data]) -> Void

    @State private var showLibrary = false
    @State private var showCamera = false

    var body: some View {
        Menu {
            if deviceHasCamera {
                Button("Take a photo", image: ImageResource(name: "Icons/camera", bundle: .main)) { showCamera = true }
            }
            Button("Choose from library", image: ImageResource(name: "Icons/image", bundle: .main)) { showLibrary = true }
        } label: {
            LWIcon("camera", size: LW.Size.iconBar)
                .foregroundStyle(remaining > 0 ? LW.Color.text2 : LW.Color.textDisabled)
                .frame(width: LW.Size.tapMin, height: LW.Size.tapMin)
                .contentShape(Circle())
        }
        .menuStyle(.button)
        .buttonStyle(.lwPlain)
        .disabled(remaining <= 0)
        .accessibilityLabel("Add a photo")
        .accessibilityHint(remaining > 0 ? "Take one, or choose from your library" : "You've added as many as fit")
        .modifier(PhotoSourcing(remaining: remaining, showLibrary: $showLibrary, showCamera: $showCamera, onAdd: onAdd))
    }
}

/// The system camera.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onCapture(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

/// The close-up / wide-shot guidance, while it applies.
struct PhotoHintLabel: View {
    let count: Int

    var body: some View {
        if let hint = photoHint(count: count) {
            HStack(alignment: .top, spacing: 8) {
                LWIcon("camera", size: 18).padding(.top, 1)
                Text(hint).lwText(.caption).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(LW.Color.text2)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Showing photos

/// A job photo from the API, in black and white. `Photo.path` needs a token, so
/// it can't go through AsyncImage. Pass the photo-only upload token (`JobFlowModel.photoToken`).
struct RemotePhoto: View {
    let path: String
    let token: String

    @Environment(\.api) private var api
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Rectangle()
            .fill(LW.Color.glassInner)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill().grayscale(1)
                } else if failed {
                    LWIcon("image").foregroundStyle(LW.Color.text3)
                }
            }
            .clipped()
            .accessibilityElement()
            .accessibilityLabel("Job photo")
            .task(id: path) {
                do {
                    let data = try await api.photoData(path: path, token: token)
                    image = UIImage(data: data)
                    failed = image == nil
                } catch {
                    failed = !(error is CancellationError)
                }
            }
    }
}

/// One of the customer's photos in the chat: 170 × 122, radius 16, black and white.
/// `failed` adds the 2pt ink ring and "Didn't send. Tap to retry." under it.
struct PhotoBubble<Content: View>: View {
    var failed = false
    @ViewBuilder var content: () -> Content

    static var size: CGSize { CGSize(width: 170, height: 122) }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            content()
                .frame(width: Self.size.width, height: Self.size.height)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .lwRing(failed, radius: 16)
            if failed {
                LWErrorNote("Didn't send. Tap to retry.")
            }
        }
    }
}

/// A small glass circle with an x, for taking a photo off. 44pt hit area.
struct PhotoRemoveButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            LWIcon("x", size: 14)
                .foregroundStyle(LW.Color.text)
                .frame(width: 28, height: 28)
                .lwGlassCircle()
                .frame(width: LW.Size.tapMin, height: LW.Size.tapMin)
                .contentShape(Rectangle())
        }
        .buttonStyle(.lwPlain)
        .accessibilityLabel("Remove photo")
    }
}

/// The job's photos and those still uploading, in a grid.
struct JobPhotoGrid: View {
    let model: JobFlowModel
    var canRemove = true

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: 8)]

    var body: some View {
        if !model.photos.isEmpty || !model.uploads.isEmpty {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
                    RemotePhoto(path: photo.path, token: model.photoToken)
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityLabel("Your photo, \(index + 1) of \(model.photos.count)")
                        .overlay(alignment: .topTrailing) {
                            if canRemove {
                                PhotoRemoveButton { model.removePhoto(photo) }
                            }
                        }
                }
                ForEach(model.uploads) { upload in
                    UploadTile(preview: upload.preview, error: upload.error) {
                        model.dismissUpload(upload.id)
                    }
                }
            }
        }
    }
}

/// A photo on its way up: a dimmed preview with "Sending…", or the error with an ink ring.
struct UploadTile: View {
    let preview: UIImage?
    let error: String?
    let onDismiss: () -> Void

    var body: some View {
        Rectangle()
            .fill(LW.Color.glassInner)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let preview {
                    Image(uiImage: preview).resizable().scaledToFill().grayscale(1).opacity(0.45)
                }
            }
            .overlay {
                if let error {
                    VStack(spacing: 2) {
                        Text("Didn't send.").lwText(.footnote).fontWeight(.bold)
                        Text(error).lwText(.footnote).lineLimit(2).minimumScaleFactor(0.8)
                        Button("Dismiss", action: onDismiss).buttonStyle(.lwLink)
                    }
                    .foregroundStyle(LW.Color.text)
                    .multilineTextAlignment(.center)
                    .padding(6)
                } else {
                    Text("Sending…")
                        .lwText(.footnote)
                        .foregroundStyle(LW.Color.text)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .lwGlassPill()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .lwRing(error != nil, radius: 16)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(error.map { "Photo didn't send: \($0)" } ?? "Sending photo")
    }
}
