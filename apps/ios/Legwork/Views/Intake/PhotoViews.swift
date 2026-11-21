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

/// "Choose photos" (PhotosPicker) and "Take a photo" (the camera, when there is one).
struct PhotoSourceButtons: View {
    /// How many more photos fit.
    let remaining: Int
    let onAdd: ([Data]) -> Void

    @State private var items: [PhotosPickerItem] = []
    @State private var showCamera = false
    private let hasCamera = UIImagePickerController.isSourceTypeAvailable(.camera)

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                if hasCamera {
                    Button {
                        showCamera = true
                    } label: {
                        Label("Take a photo", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity, minHeight: 30)
                    }
                    .buttonStyle(.glassProminent)
                }
                PhotosPicker(
                    selection: $items,
                    maxSelectionCount: max(1, remaining),
                    selectionBehavior: .ordered,
                    matching: .images
                ) {
                    Label(hasCamera ? "Library" : "Choose photos", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
            .disabled(remaining <= 0)
        }
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
            Label(hint, systemImage: count == 0 ? "camera.macro" : "camera.viewfinder")
                .font(.subheadline)
                .foregroundStyle(.muted)
        }
    }
}

/// A job photo from the API. `Photo.path` needs the token, so it can't go through AsyncImage.
struct RemotePhoto: View {
    let path: String
    let token: String

    @Environment(\.api) private var api
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Rectangle()
            .fill(Color.brandSoft.opacity(0.5))
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if failed {
                    Image(systemName: "photo").foregroundStyle(.muted)
                } else {
                    ProgressView()
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

/// The job's photos and those still uploading, in a grid.
struct JobPhotoGrid: View {
    let model: JobFlowModel
    var canRemove = true

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: 8)]

    var body: some View {
        if !model.photos.isEmpty || !model.uploads.isEmpty {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(model.photos) { photo in
                    RemotePhoto(path: photo.path, token: model.token)
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 14))
                        .overlay(alignment: .topTrailing) {
                            if canRemove {
                                Button {
                                    model.removePhoto(photo)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.caption.bold())
                                        .frame(width: 28, height: 28)
                                }
                                .buttonStyle(.glass)
                                .buttonBorderShape(.circle)
                                .padding(4)
                                .accessibilityLabel("Remove photo")
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

/// A photo on its way up: a dimmed preview with a spinner, or the error.
struct UploadTile: View {
    let preview: UIImage?
    let error: String?
    let onDismiss: () -> Void

    var body: some View {
        Rectangle()
            .fill(Color.brandSoft.opacity(0.5))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let preview {
                    Image(uiImage: preview).resizable().scaledToFill().opacity(0.45)
                }
            }
            .overlay {
                if let error {
                    VStack(spacing: 4) {
                        Text(error).font(.caption2.weight(.semibold)).foregroundStyle(.red).multilineTextAlignment(.center)
                        Button("Dismiss", action: onDismiss).font(.caption2.weight(.semibold))
                    }
                    .padding(6)
                } else {
                    ProgressView()
                }
            }
            .clipShape(.rect(cornerRadius: 14))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(error.map { "Photo failed to upload: \($0)" } ?? "Uploading photo")
    }
}
