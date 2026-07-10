# Permissão local
export permitted="teste2"

# URL da página do GitHub
VERSION_PAGE="https://github.com/Everton-Lourens/preset/blob/main/version.json"

if [ -x "$HOME/huawai/iniciar-servidor.sh" ]; then
    if ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then

        if curl -fsSL "$VERSION_PAGE" | grep -Fq "$permitted"; then
            if "$HOME/huawai/iniciar-servidor.sh" >/dev/null 2>&1; then
                clear
                echo "."
                echo ".."
                echo "..."
                echo "....."
                echo "......."
                echo "........."
                echo "..........."
                echo "............."
                echo "Servidor iniciado!"
                echo "JÁ PODE VOLTAR AO APLICATIVO DE PRESET!"
                sleep 2
                exit
            else
                clear
                echo "Falha ao iniciar o servidor."
            fi
        else
            clear
            echo "."
            echo ".."
            echo "..."
            echo "....."
            echo "......."
            echo "........."
            echo "..........."
            echo "............."
            echo "Acesso negado."
            echo "Fale com o suporte."
        fi

    else
        clear
        echo "."
        echo ".."
        echo "..."
        echo "....."
        echo "......."
        echo "........."
        echo "..........."
        echo "............."
        echo "Sem conexão com a internet."
        echo "CONECTE-SE NA INTERNET PARA LIGAR O SERVIDOR."
    fi
fi

export PATH=$HOME/.npm-global/bin:$PATH
