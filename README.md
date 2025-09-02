# LLM Wars

LLM Wars is a web application that allows you to compare responses from multiple Large Language Models (LLMs) side-by-side. Enter a single prompt, select the models you want to test, and see how they perform. This project is powered by the Gravix Layer API.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

You need to have Node.js and npm (or pnpm/yarn) installed on your machine.

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/gravixlayer/llm-wars.git
    ```
2.  Navigate to the project directory:
    ```sh
    cd llm-wars
    ```
3.  Install the dependencies:
    ```sh
    npm install
    # or
    pnpm install
    # or
    yarn install
    ```

### Running the Application

1.  Start the development server:
    ```sh
    npm run dev
    # or
    pnpm dev
    # or
    yarn dev
    ```
2.  Open your browser and go to `http://localhost:3000`.

## Usage

-   **Select Models**: Choose one or more LLMs from the "Models" dropdown list.
-   **Enter Your Prompt**: Type any question, instruction, or text you want the models to respond to in the prompt box.
-   **Adjust Temperature**: Use the slider to control the randomness of the output. A lower value makes the output more deterministic, while a higher value makes it more creative.
-   **Generate**: Click the "Generate" button to send your prompt to the selected models.
-   **Compare**: The responses will appear in cards, allowing you to compare their quality, speed, and content.

## Deployment

To deploy this application to a production environment, you can build the app and start the server.

1.  Build the application:
    ```sh
    npm run build
    # or
    pnpm build
    # or
    yarn build
    ```
2.  Start the server:
    ```sh
    npm run start
    # or
    pnpm start
    # or
    yarn start
    ```

Make sure to set any required environment variables in a `.env.local` file.

## Security & Privacy

This application is designed with your privacy in mind.
-   No user accounts are required.
-   The prompts you enter and the responses you receive are not stored or logged.
-   Everything is cleared when you refresh or leave the site.

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Disclaimer

We do not store or save your prompts or the generated responses. All data is ephemeral and is cleared as soon as you leave or refresh the site. Your privacy and security are our priority.