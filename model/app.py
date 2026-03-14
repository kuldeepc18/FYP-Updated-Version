from __future__ import annotations

from io import BytesIO, StringIO
import os

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from predictor_service import (
    BASE_DIR,
    MODELS_DIR,
    predict_csv_bytes,
    predict_dataframe,
    read_csv_bytes,
)


app = FastAPI(
    title="Trader Type Prediction API",
    description="Upload an unlabeled order-event CSV and receive user-level trader_type predictions.",
    version="1.0.0",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_csv_upload(file: UploadFile) -> bool:
    return bool(file.filename and file.filename.lower().endswith(".csv"))


def _format_prediction_response(predictions: pd.DataFrame, response_format: str, filename: str):
    if response_format == "xlsx":
        excel_buffer = BytesIO()
        with pd.ExcelWriter(excel_buffer, engine="openpyxl") as writer:
            predictions.to_excel(writer, index=False, sheet_name="predictions")
        excel_buffer.seek(0)
        return StreamingResponse(
            iter([excel_buffer.getvalue()]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    if response_format == "csv":
        csv_buffer = StringIO()
        predictions.to_csv(csv_buffer, index=False)
        csv_buffer.seek(0)
        return StreamingResponse(
            iter([csv_buffer.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    return JSONResponse(
        {
            "rows": len(predictions),
            "columns": predictions.columns.tolist(),
            "predictions": predictions.to_dict(orient="records"),
        }
    )


@app.get("/", response_class=HTMLResponse)
def upload_page() -> str:
        return """
<!doctype html>
<html lang=\"en\">
<head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Trader Type Prediction API</title>
    <style>
        body { font-family: Segoe UI, Arial, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
        h1 { margin-bottom: 0.3rem; }
        section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
        label { display: block; margin: 0.6rem 0 0.3rem; }
        button { margin-top: 1rem; padding: 0.5rem 0.9rem; cursor: pointer; }
        .hint { color: #555; font-size: 0.92rem; }
        .result-box { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-top: 1rem; }
        .manipulators-box { min-height: 42px; border: 1px dashed #b8b8b8; border-radius: 6px; padding: 0.7rem; background: #fafafa; }
        .scroll-wrap { overflow-x: auto; border: 1px solid #ddd; border-radius: 6px; margin-top: 0.7rem; }
        table { border-collapse: collapse; min-width: 1200px; width: max-content; }
        th, td { border: 1px solid #ddd; padding: 0.45rem 0.5rem; white-space: nowrap; text-align: left; }
        th { background: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Trader Type Prediction API</h1>
    <p class=\"hint\">Use these forms to test endpoints in your browser.</p>

    <section>
        <h2>Single CSV Prediction</h2>
        <form id=\"single-form\" action=\"/predict\" method=\"post\" enctype=\"multipart/form-data\">
            <label for=\"single-file\">CSV file</label>
            <input id=\"single-file\" type=\"file\" name=\"file\" accept=\".csv\" required />

            <label for=\"single-format\">Response format</label>
            <select id=\"single-format\" name=\"response_format\">
                <option value=\"json\">json</option>
                <option value=\"csv\">csv</option>
                <option value=\"xlsx\" selected>xlsx</option>
            </select>

            <button type=\"submit\">Predict from Single CSV</button>
        </form>
    </section>

    <section>
        <h2>Combined Layering + Spoofing Prediction</h2>
        <form id=\"combined-form\" action=\"/predict-combined\" method=\"post\" enctype=\"multipart/form-data\">
            <label for=\"layering-file\">Layering CSV</label>
            <input id=\"layering-file\" type=\"file\" name=\"layering_file\" accept=\".csv\" required />

            <label for=\"spoofing-file\">Spoofing CSV</label>
            <input id=\"spoofing-file\" type=\"file\" name=\"spoofing_file\" accept=\".csv\" required />

            <label for=\"combined-format\">Response format</label>
            <select id=\"combined-format\" name=\"response_format\">
                <option value=\"json\">json</option>
                <option value=\"csv\">csv</option>
                <option value=\"xlsx\" selected>xlsx</option>
            </select>

            <button type=\"submit\">Predict from Combined CSVs</button>
        </form>
    </section>

    <section class=\"result-box\">
        <h2>Manipulators (predicted_trader_type = 1)</h2>
        <div id=\"manipulators\" class=\"manipulators-box\">Run a prediction to see manipulators.</div>
        <h3 style=\"margin-top: 1rem;\">Metrics Preview (Horizontal Scroll)</h3>
        <div class=\"scroll-wrap\">
            <table id=\"metrics-table\"></table>
        </div>
    </section>

    <script>
        function toCsvCell(value) {
            if (value === null || value === undefined) return '';
            return String(value);
        }

        function renderMetrics(predictions) {
            const table = document.getElementById('metrics-table');
            if (!predictions || predictions.length === 0) {
                table.innerHTML = '<tr><td>No prediction rows found.</td></tr>';
                return;
            }

            const columns = Object.keys(predictions[0]);
            const head = '<tr>' + columns.map(c => `<th>${c}</th>`).join('') + '</tr>';
            const rows = predictions.slice(0, 50).map(row => (
                '<tr>' + columns.map(c => `<td>${toCsvCell(row[c])}</td>`).join('') + '</tr>'
            )).join('');
            table.innerHTML = head + rows;
        }

        function renderManipulators(predictions) {
            const box = document.getElementById('manipulators');
            const manipulators = (predictions || []).filter(
                row => String(row.predicted_trader_type) === '1'
            );

            if (manipulators.length === 0) {
                box.textContent = 'No manipulators found in this response.';
                return;
            }

            const ids = manipulators.map(r => r.user_id).filter(v => v !== undefined && v !== null);
            box.textContent = `Count: ${manipulators.length} | User IDs: ${ids.join(', ')}`;
        }

        async function downloadFile(url, formData, filename) {
            const response = await fetch(url, { method: 'POST', body: formData });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text);
            }
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        async function runPrediction(endpoint, formElement, defaultFilename) {
            const selectedFormat = new FormData(formElement).get('response_format') || 'xlsx';

            // Always fetch JSON once to render manipulators and metrics preview.
            const previewData = new FormData(formElement);
            previewData.set('response_format', 'json');
            const previewResponse = await fetch(`${endpoint}?response_format=json`, {
                method: 'POST',
                body: previewData,
            });

            if (!previewResponse.ok) {
                const text = await previewResponse.text();
                throw new Error(text);
            }

            const previewText = await previewResponse.text();
            let previewJson = null;
            try {
                previewJson = JSON.parse(previewText);
            } catch (error) {
                throw new Error(`Preview response is not valid JSON: ${previewText.slice(0, 300)}`);
            }

            const predictionRows = Array.isArray(previewJson?.predictions) ? previewJson.predictions : [];
            if (!Array.isArray(previewJson?.predictions)) {
                console.warn('Unexpected preview payload:', previewJson);
            }

            renderManipulators(predictionRows);
            renderMetrics(predictionRows);

            if (selectedFormat === 'json') {
                alert('JSON preview rendered below.');
                return;
            }

            const downloadData = new FormData(formElement);
            downloadData.set('response_format', selectedFormat);
            const extension = selectedFormat === 'csv' ? 'csv' : 'xlsx';
            await downloadFile(`${endpoint}?response_format=${selectedFormat}`, downloadData, `${defaultFilename}.${extension}`);
        }

        document.getElementById('single-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await runPrediction('/predict', event.target, 'predictions_single');
            } catch (error) {
                alert(`Single prediction failed: ${error.message}`);
            }
        });

        document.getElementById('combined-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await runPrediction('/predict-combined', event.target, 'predictions_combined');
            } catch (error) {
                alert(`Combined prediction failed: ${error.message}`);
            }
        });
    </script>
</body>
</html>
"""


@app.get("/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "base_dir": str(BASE_DIR),
        "models_dir": str(MODELS_DIR),
    }


@app.post("/predict")
async def predict_csv(
    file: UploadFile = File(...),
    response_format: str = Query("xlsx", pattern="^(json|csv|xlsx)$"),
):
    if not _is_csv_upload(file):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    try:
        file_bytes = await file.read()
        predictions = predict_csv_bytes(file_bytes, file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    output_filename = {
        "csv": "predictions.csv",
        "xlsx": "predictions.xlsx",
    }.get(response_format, "predictions.json")
    return _format_prediction_response(predictions, response_format, output_filename)


@app.post("/predict-combined")
async def predict_combined_csv(
    layering_file: UploadFile = File(...),
    spoofing_file: UploadFile = File(...),
    response_format: str = Query("xlsx", pattern="^(json|csv|xlsx)$"),
):
    if not _is_csv_upload(layering_file) or not _is_csv_upload(spoofing_file):
        raise HTTPException(status_code=400, detail="Please upload both files as .csv")

    try:
        layering_bytes = await layering_file.read()
        spoofing_bytes = await spoofing_file.read()

        layering_df = read_csv_bytes(layering_bytes, layering_file.filename or "layering.csv")
        spoofing_df = read_csv_bytes(spoofing_bytes, spoofing_file.filename or "spoofing.csv")
        combined_df = pd.concat([layering_df, spoofing_df], ignore_index=True)
        predictions = predict_dataframe(combined_df)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Combined prediction failed: {exc}") from exc

    output_filename = {
        "csv": "combined_predictions.csv",
        "xlsx": "combined_predictions.xlsx",
    }.get(response_format, "combined_predictions.json")
    return _format_prediction_response(predictions, response_format, output_filename)